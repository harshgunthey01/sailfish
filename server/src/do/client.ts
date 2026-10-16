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
    return {
      prepaid_amount: num(j.prepaid_amount),
      used_amount: num(j.used_amount),
      spend_limit: num(j.spend_limit),
      prepay_threshold: num(j.prepay_threshold),
      raw: j,
    };
  }

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
