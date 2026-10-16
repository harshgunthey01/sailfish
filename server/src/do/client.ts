/**
 * Typed DigitalOcean REST client (undici via global fetch).
 * Control-plane: /v2/* with the standard OAuth token.
 * Inference:     /v1/* with $MODEL_ACCESS_KEY.
 * All calls: short timeouts + 1 retry on 5xx/network errors. Never throws raw.
 */

const CTRL = "https://api.digitalocean.com";
const INF = "https://api.digitalocean.com";

export class DOError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`DO API ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

async function req(
  base: string,
  token: string,
  method: string,
  pathName: string,
  body?: unknown
): Promise<{ status: number; json: any; text: string }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(base + pathName, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      if (res.status >= 500 && attempt === 0) continue;
      return { status: res.status, json, text };
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 750));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function expect(status: number, json: any, text: string): any {
  if (status >= 400) throw new DOError(status, text);
  return json;
}

export interface BalanceInfo {
  month_to_date_balance: number;
  account_balance: number;
  generated_at: string;
}

export interface PrepaymentInfo {
  prepaid_amount?: number;
  used_amount?: number;
  /** Remaining prepaid credit, from the nested `status.balance` field. */
  remaining_balance?: number;
  spend_limit?: number;
  prepay_threshold?: number;
  raw: any;
}

export interface DOModel {
  name: string;
  id?: string;
  provider?: string;
  type?: string;
  upload_tokens?: string;
  download_tokens?: string;
}

// ---- billing insights (per-SKU day-over-day usage) ----
export interface BillingDataPoint {
  usage_team_urn: string;
  start_date: string;
  total_amount: string;
  region: string;
  sku: string;
  description: string;
  group_description?: string;
}
export interface AccountInfo {
  uuid?: string;
  email?: string;
  name?: string;
  team_uuid?: string;
  team_name?: string;
  status?: string;
}

// ---- GenAI Model Routers (control plane: /v2/gen-ai/models/routers) ----
export interface ModelRouterSelectionPolicy {
  prefer?: "none" | "cheapest" | "fastest" | string;
}
export interface ModelRouterTaskDetails {
  name?: string;
  description?: string;
}
export interface ModelRouterTaskPolicy {
  task_slug?: string;
  models?: string[];
  selection_policy?: ModelRouterSelectionPolicy;
  custom_task?: ModelRouterTaskDetails;
}
export interface ModelRouterConfig {
  fallback_models?: string[];
  policies?: ModelRouterTaskPolicy[];
}
export interface ModelRouter {
  uuid: string;
  name: string;
  description?: string;
  regions?: string[];
  created_at?: string;
  updated_at?: string;
  config?: ModelRouterConfig;
}
export interface ModelRouterInput {
  name: string;
  description?: string;
  fallback_models: string[];
  policies?: ModelRouterTaskPolicy[];
  regions?: string[];
}

export class DOClient {
  constructor(
    private ctrlToken: string,
    private modelKey: string
  ) {}

  // ---- control plane ----
  async balance(): Promise<BalanceInfo> {
    const { status, json, text } = await req(CTRL, this.ctrlToken, "GET", "/v2/customers/my/balance");
    const j = expect(status, json, text);
    return {
      month_to_date_balance: parseFloat(String(j.month_to_date_balance ?? 0)) || 0,
      account_balance: parseFloat(String(j.account_balance ?? 0)) || 0,
      generated_at: j.generated_at ?? new Date().toISOString(),
    };
  }

  async prepaymentConfig(): Promise<PrepaymentInfo> {
    const { status, json, text } = await req(
      CTRL,
      this.ctrlToken,
      "GET",
      "/v2/customers/my/prepayment_config"
    );
    if (status === 404) return { raw: null };
    const j = expect(status, json, text);
    // Live shape is nested ({config: {prepay_amount, ...}, status: {balance, ...}});
    // keep top-level reads as fallback for older shapes.
    const cfg = j.config ?? {};
    return {
      prepaid_amount: num(j.prepaid_amount ?? cfg.prepay_amount),
      used_amount: num(j.used_amount ?? cfg.used_amount),
      remaining_balance: num(j.status?.balance ?? j.balance),
      spend_limit: num(j.spend_limit ?? cfg.spend_limit),
      prepay_threshold: num(j.prepay_threshold ?? cfg.prepay_threshold),
      raw: j,
    };
  }

  /** Account identity + team UUID (used to build the billing-insights URN). */
  async account(): Promise<AccountInfo> {
    const { status, json, text } = await req(CTRL, this.ctrlToken, "GET", "/v2/account");
    const j = expect(status, json, text);
    const a = j.account ?? j;
    return {
      uuid: a.uuid,
      email: a.email,
      name: a.name,
      team_uuid: a.team?.uuid,
      team_name: a.team?.name,
      status: a.status,
    };
  }

  /**
   * Day-over-day per-SKU billing insight lines (nightly invoice-item estimates).
   * Returns the raw data points; classification into core-compute vs AI vs tax
   * happens in the billing service.
   */
  async billingInsights(
    accountUrn: string,
    startDate: string,
    endDate: string
  ): Promise<BillingDataPoint[]> {
    const path = `/v2/billing/${encodeURIComponent(accountUrn)}/insights/${startDate}/${endDate}?per_page=200`;
    const { status, json, text } = await req(CTRL, this.ctrlToken, "GET", path);
    if (status === 404) return [];
    const j = expect(status, json, text);
    return (j.data_points ?? []) as BillingDataPoint[];
  }

  /** Open / upcoming invoices for the billing history widget. */
  async openInvoices(): Promise<Array<{ invoice_id: string; amount: string; period: string }>> {
    const { status, json, text } = await req(CTRL, this.ctrlToken, "GET", "/v2/customers/my/invoices?per_page=5");
    if (status === 404) return [];
    const j = expect(status, json, text);
    return (j.invoices ?? [])
      .filter((i: any) => i.invoice_status === "open" || i.invoice_status === "Upcoming")
      .map((i: any) => ({
        invoice_id: i.invoice_id,
        amount: i.invoice_amount ?? i.amount ?? "0",
        period: i.invoice_period ?? "",
      }));
  }

  // ---- GenAI model routers (control plane) ----
  async listModelRouters(): Promise<ModelRouter[]> {
    const { status, json, text } = await req(
      CTRL,
      this.ctrlToken,
      "GET",
      "/v2/gen-ai/models/routers?per_page=200"
    );
    const j = expect(status, json, text);
    return (j.model_routers ?? []) as ModelRouter[];
  }

  async getModelRouter(uuid: string): Promise<ModelRouter> {
    const { status, json, text } = await req(
      CTRL,
      this.ctrlToken,
      "GET",
      `/v2/gen-ai/models/routers/${encodeURIComponent(uuid)}`
    );
    return expect(status, json, text).model_router as ModelRouter;
  }

  async createModelRouter(input: ModelRouterInput): Promise<ModelRouter> {
    const { status, json, text } = await req(
      CTRL,
      this.ctrlToken,
      "POST",
      "/v2/gen-ai/models/routers",
      input
    );
    const j = expect(status, json, text);
    return (j.model_router ?? j) as ModelRouter;
  }

  async updateModelRouter(uuid: string, input: ModelRouterInput): Promise<ModelRouter> {
    const { status, json, text } = await req(
      CTRL,
      this.ctrlToken,
      "PUT",
      `/v2/gen-ai/models/routers/${encodeURIComponent(uuid)}`,
      input
    );
    const j = expect(status, json, text);
    return (j.model_router ?? j) as ModelRouter;
  }

  async deleteModelRouter(uuid: string): Promise<void> {
    const { status, text } = await req(
      CTRL,
      this.ctrlToken,
      "DELETE",
      `/v2/gen-ai/models/routers/${encodeURIComponent(uuid)}`
    );
    if (status >= 400) throw new DOError(status, text);
  }

  // ---- inference plane ----
  async models(): Promise<DOModel[]> {
    const { status, json, text } = await req(INF, this.modelKey, "GET", "/v1/models");
    const j = expect(status, json, text);
    const list = Array.isArray(j) ? j : (j.data ?? []);
    return list.map((m: any) => ({
      name: m.name ?? m.id ?? String(m),
      id: m.id,
      provider: m.provider,
      type: m.type,
      upload_tokens: m.upload_tokens,
      download_tokens: m.download_tokens,
    }));
  }

  async testControlPlane(): Promise<{ ok: boolean; detail: string }> {
    try {
      const b = await this.balance();
      return { ok: true, detail: `balance ok (mtd $${b.month_to_date_balance.toFixed(2)})` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async testInference(): Promise<{ ok: boolean; detail: string }> {
    try {
      const m = await this.models();
      return { ok: true, detail: `models ok (${m.length} available)` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}
