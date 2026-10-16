/**
 * Typed DigitalOcean REST client (undici via global fetch).
 * Control-plane: /v2/* with the standard OAuth token.
 * Inference:     /v1/* with $MODEL_ACCESS_KEY.
 * All calls: short timeouts + 1 retry on 5xx/network errors. Never throws raw.
 */

const CTRL = "https://api.digitalocean.com";
// Serverless inference plane (model list, chat completions) lives on a
// separate base URL and authenticates with the model access key — NOT the
// OAuth token, and NOT api.digitalocean.com (which 404s /v1/* paths).
const INF = "https://inference.do-ai.run";

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

/** Subset of a DigitalOcean droplet (inventory display only). */
export interface Droplet {
  id: number;
  name: string;
  status?: string;
  region?: string;
  size?: string;
  created_at?: string;
  tags?: string[];
}

/** Generic named resource row for inventory tables. */
export interface NamedResource {
  id: string | number;
  name: string;
  status?: string;
  region?: string;
  size?: string;
  created_at?: string;
}

export interface Database {
  id: string;
  name: string;
  engine?: string;
  version?: string;
  size?: string;
  region?: string;
  status?: string;
  created_at?: string;
}

export interface Volume {
  id: string;
  name: string;
  size_gb?: number;
  region?: string;
  attached_to: string[];
  created_at?: string;
}

export interface Snapshot {
  id: string;
  name: string;
  resource_type?: string;
  size_gb?: number;
  regions?: string[];
  created_at?: string;
}

export interface ReservedIp {
  ip: string;
  region?: string;
  attached_to: string | null;
}

export interface Agent {
  uuid: string;
  name: string;
  status?: string;
  created_at?: string;
  usage?: any;
}

/** One entry from GET /v2/customers/my/billing_history (payments, invoices...). */
export interface BillingHistoryEntry {
  description: string;
  amount: string;
  date: string;
  type: string;
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

  /** Payment / invoice ledger (e.g. the Visa payment that funded AI credits). */
  async billingHistory(perPage = 20): Promise<BillingHistoryEntry[]> {
    const { status, json, text } = await req(
      CTRL,
      this.ctrlToken,
      "GET",
      `/v2/customers/my/billing_history?per_page=${perPage}`
    );
    if (status === 404) return [];
    const j = expect(status, json, text);
    return (j.billing_history ?? []) as BillingHistoryEntry[];
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

  // ---- core compute: droplet inventory (read-only) ----
  async listDroplets(): Promise<Droplet[]> {    const out: Droplet[] = [];
    let page = 1;
    for (;;) {
      const { status, json, text } = await req(
        CTRL,
        this.ctrlToken,
        "GET",
        `/v2/droplets?per_page=200&page=${page}`
      );
      if (status === 404) return out;
      const j = expect(status, json, text);
      for (const d of j.droplets ?? []) {
        out.push({
          id: d.id,
          name: d.name,
          status: d.status,
          region: d.region?.slug ?? d.region,
          size: d.size_slug ?? d.size,
          created_at: d.created_at,
          tags: d.tags ?? [],
        });
      }
      const pages = j.meta?.total ?? 1;
      if (page >= pages || (j.droplets ?? []).length === 0) break;
      page++;
      if (page > 50) break; // sanity cap
    }
    return out;
  }

  /** Droplet host metrics passthrough (MONITORING.md Phase 3/B1). Read-only. */
  async dropletMetrics(
    hostId: string | number,
    metric: string,
    start: string,
    end: string
  ): Promise<any> {
    // Exact paths per the DO OpenAPI spec (there is no plain `memory` or
    // disk_read/write droplet metric; bandwidth needs extra interface params).
    const allowed = [
      "cpu",
      "load_1",
      "load_5",
      "load_15",
      "memory_available",
      "memory_free",
      "memory_total",
      "memory_cached",
      "filesystem_free",
      "filesystem_size",
    ];
    if (!allowed.includes(metric)) throw new DOError(400, `unknown metric: ${metric}`);
    const q = `host_id=${encodeURIComponent(String(hostId))}&start=${start}&end=${end}`;
    const { status, json, text } = await req(
      CTRL,
      this.ctrlToken,
      "GET",
      `/v2/monitoring/metrics/droplet/${metric}?${q}`
    );
    return expect(status, json, text);
  }

  // ---- core inventory: other billable products (read-only) ----
  private async fetchAll(key: string, base: string): Promise<any[]> {
    const out: any[] = [];
    let page = 1;
    for (;;) {
      const { status, json, text } = await req(
        CTRL,
        this.ctrlToken,
        "GET",
        `${base}?per_page=200&page=${page}`
      );
      if (status === 404) return out;
      const j = expect(status, json, text);
      const arr = j[key] ?? [];
      out.push(...arr);
      const pages = j.meta?.total ?? 1;
      if (page >= pages || arr.length === 0) break;
      if (++page > 50) break;
    }
    return out;
  }

  async listDatabases(): Promise<Database[]> {
    const rows = await this.fetchAll("databases", "/v2/databases");
    return rows.map((d: any) => ({
      id: d.id ?? d.name,
      name: d.name,
      engine: d.engine,
      version: d.version,
      size: d.size,
      region: d.region,
      status: d.status,
      created_at: d.created_at,
    }));
  }

  async listMicrovms(): Promise<NamedResource[]> {
    const rows = await this.fetchAll("microvms", "/v2/microvms");
    return rows.map((m: any) => ({
      id: m.id,
      name: m.name ?? m.id,
      status: m.status,
      region: m.region?.slug ?? m.region,
      size: m.size,
      created_at: m.created_at,
    }));
  }

  async listK8sClusters(): Promise<NamedResource[]> {
    const rows = await this.fetchAll("kubernetes_clusters", "/v2/kubernetes/clusters");
    return rows.map((k: any) => ({
      id: k.id,
      name: k.name,
      status: k.status?.state ?? k.status,
      region: k.region,
      size: `${k.node_pools?.reduce((n: number, p: any) => n + (p.count ?? 0), 0) ?? 0} nodes`,
      created_at: k.created_at,
    }));
  }

  async listApps(): Promise<NamedResource[]> {
    const rows = await this.fetchAll("apps", "/v2/apps");
    return rows.map((a: any) => ({
      id: a.id,
      name: a.spec?.name ?? a.id,
      status: a.active_deployment ? "active" : "inactive",
      region: a.region?.slug ?? a.region,
      created_at: a.created_at,
    }));
  }

  async listVolumes(): Promise<Volume[]> {
    const rows = await this.fetchAll("volumes", "/v2/volumes");
    return rows.map((v: any) => ({
      id: v.id,
      name: v.name,
      size_gb: v.size_gigabytes,
      region: v.region?.slug ?? v.region,
      attached_to: (v.droplet_ids ?? []).map(String),
      created_at: v.created_at,
    }));
  }

  async listSnapshots(): Promise<Snapshot[]> {
    const rows = await this.fetchAll("snapshots", "/v2/snapshots");
    return rows.map((s: any) => ({
      id: s.id,
      name: s.name,
      resource_type: s.resource_type,
      size_gb: s.size,
      regions: s.regions ?? [],
      created_at: s.created_at,
    }));
  }

  async listLoadBalancers(): Promise<NamedResource[]> {
    const rows = await this.fetchAll("load_balancers", "/v2/load_balancers");
    return rows.map((l: any) => ({
      id: l.id,
      name: l.name,
      status: l.status,
      region: l.region?.slug ?? l.region,
      size: l.size_unit ? `${l.size_unit} unit(s)` : undefined,
      created_at: l.created_at,
    }));
  }

  async listReservedIps(): Promise<ReservedIp[]> {
    const rows = await this.fetchAll("reserved_ips", "/v2/reserved_ips");
    return rows.map((r: any) => ({
      ip: r.ip,
      region: r.region?.slug ?? r.region,
      attached_to: r.droplet ? String(r.droplet.id ?? r.droplet.name ?? "") : null,
    }));
  }

  async listFunctionNamespaces(): Promise<NamedResource[]> {
    const rows = await this.fetchAll("namespaces", "/v2/functions/namespaces");
    return rows.map((n: any) => ({
      id: n.id ?? n.namespace,
      name: n.label ?? n.namespace ?? n.id,
      region: n.region,
      created_at: n.created_at,
    }));
  }

  async listCdnEndpoints(): Promise<NamedResource[]> {
    const rows = await this.fetchAll("endpoints", "/v2/cdn/endpoints");
    return rows.map((e: any) => ({
      id: e.id,
      name: e.origin,
      status: e.status,
      created_at: e.created_at,
    }));
  }

  async listDomains(): Promise<NamedResource[]> {
    const rows = await this.fetchAll("domains", "/v2/domains");
    return rows.map((d: any) => ({ id: d.name, name: d.name }));
  }

  async listAgents(): Promise<Agent[]> {
    const rows = await this.fetchAll("agents", "/v2/gen-ai/agents");
    return Promise.all(
      rows.map(async (a: any) => {
        const uuid = a.uuid ?? a.id;
        let usage: any = null;
        try {
          const { status, json } = await req(
            CTRL,
            this.ctrlToken,
            "GET",
            `/v2/gen-ai/agents/${encodeURIComponent(uuid)}/usage`
          );
          if (status < 400) usage = json;
        } catch {
          /* usage is best-effort */
        }
        return {
          uuid,
          name: a.name ?? uuid,
          status: a.status,
          created_at: a.created_at,
          usage,
        };
      })
    );
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
