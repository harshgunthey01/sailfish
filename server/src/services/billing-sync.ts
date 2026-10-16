import { getDb, newId, nowIso } from "../db/schema.js";
import { DOClient } from "../do/client.js";
import type { BillingDataPoint } from "../do/client.js";
import type { Vault } from "./vault.js";
import { evaluateThresholds } from "./thresholds.js";
import { notifyBreaches } from "./thresholds.js";
import { sendChannel } from "./notifier.js";

/**
 * Billing sync (PRD §2.2, ARCHITECTURE §6.2).
 *
 * Now uses the DO Billing Insights API to build a per-product breakdown,
 * so the dashboard shows the *real* GenAI usage and not the account-wide
 * month‑to‑date balance (which includes unrelated charges, credits, and tax).
 *
 * Classification rules (SKU prefix):
 *   AI usage  → sku starts with "1-AI-"
 *   AI credits → sku starts with "1-DO-AI"     (Agent & Inference purchases)
 *   Tax       → sku starts with "1-DO-ADJMT-00TAX"
 *   Credits   → total_amount < 0 (generic adjustments)
 *   Everything else → core compute
 */
import { bucketOf, modelKeyOf, tokensOf, ratesOf } from "./billing-lines.js";

export function makeClient(vault: Vault): DOClient | null {
  const doToken = vault.get("do_token");
  const modelKey = vault.get("model_access_key");
  if (!doToken || !modelKey) return null;
  return new DOClient(doToken, modelKey);
}

export interface SyncResult {
  ok: boolean;
  detail: string;
  compute_balance?: number;
  inference_balance?: number;
  /** New breakdown fields */
  month_to_date_balance?: number;
  core_compute_mtd?: number;
  ai_usage_mtd?: number;
  tax_mtd?: number;
  prepaid_amount?: number;
}

export async function syncBilling(vault: Vault): Promise<SyncResult> {
  const client = makeClient(vault);
  if (!client) return { ok: false, detail: "DO credentials not configured" };
  const db = getDb();

  try {
    const [bal, prepay] = await Promise.all([
      client.balance(),
      client.prepaymentConfig().catch(() => null),
    ]);

    // Payment ledger (funds added, e.g. the card payment behind AI credits).
    // Tolerated: history may be unavailable while balance/prepay succeed.
    let paymentsJson: string | null = null;
    try {
      const entries = await client.billingHistory(20);
      paymentsJson = JSON.stringify(entries.slice(0, 20));
    } catch (e) {
      console.warn("[billing-sync] billing_history unavailable:", e instanceof Error ? e.message : String(e));
    }

    // ---- per-product breakdown via Billing Insights ----
    let coreComputeMtd = 0;
    let aiUsageMtd = 0;
    let taxMtd = 0;
    let breakdownJson: string | null = null;

    try {
      const acct = await client.account();
      const teamUuid = acct.team_uuid;
      if (teamUuid) {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .slice(0, 10);
        const end = now.toISOString().slice(0, 10);
        const urn = `do:team:${teamUuid}`;
        const points = await client.billingInsights(urn, start, end);

        for (const p of points) {
          const amount = parseFloat(p.total_amount) || 0;
          const bucket = bucketOf(p);
          if (bucket === "tax") {
            taxMtd += amount;
          } else if (bucket === "ai" || bucket === "ai_credit") {
            aiUsageMtd += amount;
          } else if (bucket === "core") {
            coreComputeMtd += amount;
          }
          // 'credit' lines reduce the bill; no spend bucket.
        }
        writeBillingDaily(db, points);
        upsertModelRates(db, points);
        breakdownJson = JSON.stringify(points.slice(0, 200));
      }
    } catch (e) {
      // Insights may be unavailable (new accounts, insufficient perms).
      // Leave the breakdown at zero rather than mislabel the account-wide
      // month_to_date_balance as core-compute spend.
      console.warn("[billing-sync] insights unavailable:", e instanceof Error ? e.message : String(e));
    }

    // inference remaining: prefer the explicit status.balance; fall back to prepaid - used.
    let inferenceBalance: number | null = null;
    let prepaidAmount: number | null = null;
    let spendLimit: number | null = null;
    if (prepay) {
      prepaidAmount = prepay.prepaid_amount ?? null;
      if (prepay.remaining_balance !== undefined) {
        inferenceBalance = round6(prepay.remaining_balance);
      } else if (prepay.prepaid_amount !== undefined && prepay.used_amount !== undefined) {
        inferenceBalance = round6(prepay.prepaid_amount - prepay.used_amount);
      }
      spendLimit = prepay.spend_limit ?? null;
    }

    // Use the net month_to_date_balance from the balance endpoint as the
    // "compute_balance" for threshold compatibility (this is the real due amount).
    const mtd = parseFloat(String(bal.month_to_date_balance ?? 0)) || 0;
    const acctBal = parseFloat(String(bal.account_balance ?? 0)) || 0;

    const ts = nowIso();
    db.prepare(
      `UPDATE billing_state
       SET compute_balance = ?, core_compute_mtd = ?, ai_usage_mtd = ?, tax_mtd = ?,
           account_balance = ?, prepaid_amount = ?, payments_json = ?, breakdown_json = ?, inference_balance = ?, last_synced = ?
       WHERE id = 'singleton'`
    ).run(
      mtd,
      round6(coreComputeMtd),
      round6(aiUsageMtd),
      round6(taxMtd),
      acctBal,
      prepaidAmount ?? 0,
      paymentsJson,
      breakdownJson,
      inferenceBalance ?? 0,
      ts
    );

    db.prepare(
      `INSERT INTO billing_history (id, ts, compute_balance, core_compute_mtd, ai_usage_mtd, inference_balance, spend_limit)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      newId(),
      ts,
      mtd,
      round6(coreComputeMtd),
      round6(aiUsageMtd),
      inferenceBalance ?? 0,
      spendLimit
    );

    // keep history bounded: 90 days
    db.prepare(
      `DELETE FROM billing_history WHERE ts < datetime('now', '-90 days')`
    ).run();

    const spike = dailySpike(db);
    const breaches = evaluateThresholds({
      compute_balance: mtd,
      inference_balance: inferenceBalance ?? 0,
      spend_limit: spendLimit,
      daily_spend_usd: spike.today,
      daily_spend_spike: spike.ratio,
    });
    if (breaches.length > 0) {
      void notifyBreaches(breaches, (ch, msg) => sendChannel(ch, msg, vault));
    }

    return {
      ok: true,
      detail: "synced",
      compute_balance: mtd,
      inference_balance: inferenceBalance ?? 0,
      month_to_date_balance: mtd,
      core_compute_mtd: round6(coreComputeMtd),
      ai_usage_mtd: round6(aiUsageMtd),
      tax_mtd: round6(taxMtd),
      prepaid_amount: prepaidAmount ?? 0,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, detail };
  }
}

export function billingSummary() {
  const db = getDb();
  const state = db.prepare("SELECT * FROM billing_state WHERE id='singleton'").get() as any;
  let payments: Array<{ description?: string; amount?: string; date?: string; type?: string }> = [];
  try {
    payments = state?.payments_json ? JSON.parse(state.payments_json) : [];
    if (!Array.isArray(payments)) payments = [];
  } catch {
    payments = [];
  }
  const recent = db
    .prepare(
      `SELECT ts, compute_balance, core_compute_mtd, ai_usage_mtd, inference_balance, spend_limit
       FROM billing_history
       ORDER BY ts DESC LIMIT 500`
    )
    .all();
  return { state, payments, history: recent.reverse() };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Persist one insights pull into billing_daily (idempotent upsert). */
export function writeBillingDaily(db: ReturnType<typeof getDb>, points: BillingDataPoint[]) {
  const upsert = db.prepare(
    `INSERT INTO billing_daily (day, sku, model_key, description, region, prompt_tokens, completion_tokens, amount_usd)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(day, sku, description) DO UPDATE SET
       model_key = excluded.model_key,
       region = excluded.region,
       prompt_tokens = excluded.prompt_tokens,
       completion_tokens = excluded.completion_tokens,
       amount_usd = excluded.amount_usd`
  );
  for (const p of points) {
    const day = (p.start_date ?? "").slice(0, 10);
    if (!day) continue;
    const bucket = bucketOf(p);
    const { pt, ct } = tokensOf(p);
    upsert.run(
      day,
      p.sku ?? "",
      modelKeyOf(p, bucket),
      p.description ?? "",
      p.region ?? "",
      pt,
      ct,
      round6(parseFloat(p.total_amount) || 0)
    );
  }
  db.prepare(`DELETE FROM billing_daily WHERE day < date('now', '-400 days')`).run();
}

/** Model (spend) buckets in billing_daily — everything else is tax/credit/purchase noise. */
const MODEL_BUCKETS = `model_key NOT IN ('tax','credit','ai_credit_purchase')`;

/** Day totals + per-model split for charts. */
export function dailySummary(days = 30) {
  const db = getDb();
  const d = Math.min(Math.max(days, 1), 400);
  const rows = db
    .prepare(
      `SELECT day, model_key, SUM(amount_usd) AS amount,
              SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens
       FROM billing_daily
       WHERE day >= date('now', ?)
       GROUP BY day, model_key ORDER BY day ASC`
    )
    .all(`-${d} days`) as Array<{
    day: string;
    model_key: string;
    amount: number;
    prompt_tokens: number;
    completion_tokens: number;
  }>;
  return { days: rows };
}

/** Latest observed $/1M rates per model (latest annotation wins). */
export function upsertModelRates(db: ReturnType<typeof getDb>, points: BillingDataPoint[]) {
  const up = db.prepare(
    `INSERT INTO model_rates (model_key, input_per_1m, output_per_1m, cache_per_1m, observed_at)
     VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(model_key) DO UPDATE SET
       input_per_1m = COALESCE(excluded.input_per_1m, model_rates.input_per_1m),
       output_per_1m = COALESCE(excluded.output_per_1m, model_rates.output_per_1m),
       cache_per_1m = COALESCE(excluded.cache_per_1m, model_rates.cache_per_1m),
       observed_at = excluded.observed_at`
  );
  const seen = new Map<string, { input?: number; output?: number; cache?: number }>();
  for (const p of points) {
    if (bucketOf(p) !== "ai") continue;
    const key = modelKeyOf(p, "ai");
    if (key === "other-ai") continue;
    const r = ratesOf(p);
    if (r.input === undefined && r.output === undefined && r.cache === undefined) continue;
    const cur = seen.get(key) ?? {};
    if (r.input !== undefined) cur.input = r.input;
    if (r.output !== undefined) cur.output = r.output;
    if (r.cache !== undefined) cur.cache = r.cache;
    seen.set(key, cur);
  }
  for (const [key, r] of seen) {
    up.run(key, r.input ?? null, r.output ?? null, r.cache ?? null);
  }
}

export function listModelRates() {
  return getDb().prepare("SELECT * FROM model_rates ORDER BY model_key").all();
}

/** Cache effectiveness per model + overall (MONITORING.md Phase 4). */
export function cacheSummary(days = 30) {
  const db = getDb();
  const d = Math.min(Math.max(days, 1), 400);
  const rows = db
    .prepare(
      `SELECT model_key,
              SUM(CASE WHEN LOWER(description) LIKE '%cache%read%' THEN prompt_tokens ELSE 0 END) AS cache_tokens,
              SUM(CASE WHEN LOWER(description) NOT LIKE '%cache%' THEN prompt_tokens ELSE 0 END) AS input_tokens,
              SUM(completion_tokens) AS output_tokens
       FROM billing_daily
       WHERE day >= date('now', ?) AND ${MODEL_BUCKETS}
       GROUP BY model_key`
    )
    .all(`-${d} days`) as Array<{
    model_key: string;
    cache_tokens: number;
    input_tokens: number;
    output_tokens: number;
  }>;
  const rates = Object.fromEntries(
    (listModelRates() as Array<{ model_key: string; input_per_1m: number; cache_per_1m: number | null }>).map(
      (r) => [r.model_key, r]
    )
  );
  let totalCache = 0;
  let totalInput = 0;
  let totalSaved = 0;
  const by_model = rows.map((r) => {
    const rate = rates[r.model_key];
    const denom = r.cache_tokens + r.input_tokens;
    const hit_ratio = denom > 0 ? round6(r.cache_tokens / denom) : null;
    const savings =
      rate && rate.cache_per_1m != null
        ? round6((r.cache_tokens * (rate.input_per_1m - rate.cache_per_1m)) / 1e6)
        : null;
    totalCache += r.cache_tokens;
    totalInput += r.input_tokens;
    if (savings != null) totalSaved += savings;
    return {
      model_key: r.model_key,
      cache_tokens: r.cache_tokens,
      input_tokens: r.input_tokens,
      hit_ratio,
      est_savings_usd: savings,
      rates: rate && rate.cache_per_1m != null ? "observed" : "unknown",
    };
  });
  const overallDenom = totalCache + totalInput;
  return {
    overall: {
      hit_ratio: overallDenom > 0 ? round6(totalCache / overallDenom) : null,
      cache_tokens: totalCache,
      est_savings_usd: round6(totalSaved),
    },
    by_model,
  };
}

/** Today's AI-model spend + ratio vs prior-7-day mean (null ratio = no baseline). */
export function dailySpike(db: ReturnType<typeof getDb>): { today: number; ratio: number | null } {
  const todayRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM billing_daily
       WHERE day = date('now') AND ${MODEL_BUCKETS}`
    )
    .get() as { total: number };
  const meanRow = db
    .prepare(
      `SELECT COALESCE(AVG(daily), 0) AS mean FROM (
         SELECT SUM(amount_usd) AS daily FROM billing_daily
         WHERE day >= date('now', '-8 days') AND day < date('now') AND ${MODEL_BUCKETS}
         GROUP BY day
       )`
    )
    .get() as { mean: number };
  const today = round6(todayRow.total);
  const ratio = meanRow.mean > 0 ? round6(today / meanRow.mean) : null;
  return { today, ratio };
}

/** Month-to-date core-compute attribution by droplet region (MONITORING.md Phase 5).
 *  A region's spend is attributed only when exactly one droplet lives there;
 *  everything else stays under shared/unattributed — never forced. */
export function coreAttribution(droplets: Array<{ name: string; region?: string }>) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT region, COALESCE(SUM(amount_usd), 0) AS amount FROM billing_daily
       WHERE day >= date('now', 'start of month') AND model_key = 'core'
       GROUP BY region`
    )
    .all() as Array<{ region: string; amount: number }>;
  const byRegion = new Map<string, string[]>();
  for (const d of droplets) {
    const list = byRegion.get(d.region ?? "") ?? [];
    list.push(d.name);
    byRegion.set(d.region ?? "", list);
  }
  const regions = rows.map((r) => {
    const names = byRegion.get(r.region ?? "") ?? [];
    return {
      region: r.region || "(unknown)",
      amount_usd: round6(r.amount),
      droplets: names,
      attributed: names.length === 1,
    };
  });
  const attributed = round6(regions.filter((r) => r.attributed).reduce((s, r) => s + r.amount_usd, 0));
  const total = round6(regions.reduce((s, r) => s + r.amount_usd, 0));
  const state = db.prepare("SELECT core_compute_mtd FROM billing_state WHERE id='singleton'").get() as any;
  return {
    regions,
    attributed_usd: attributed,
    unattributed_usd: round6(total - attributed),
    total_usd: total,
    core_compute_mtd: state?.core_compute_mtd ?? 0,
  };
}

/** Month-end projection + days of manual credit left (MONITORING.md §A2). */
export function forecastSummary() {
  const db = getDb();
  const now = new Date();
  const elapsed = Math.max(1, now.getUTCDate());
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const mtdRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM billing_daily
       WHERE day >= date('now', 'start of month') AND ${MODEL_BUCKETS}`
    )
    .get() as { total: number };
  const mtd = round6(mtdRow.total);
  const rate = round6(mtd / elapsed);
  const credit = db
    .prepare("SELECT ai_credit_remaining, ai_credit_as_of FROM app_settings WHERE id='singleton'")
    .get() as { ai_credit_remaining: number | null; ai_credit_as_of: string | null };
  return {
    month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    elapsed_days: elapsed,
    days_in_month: dim,
    mtd_ai_usd: mtd,
    daily_rate_usd: rate,
    projected_month_end_usd: round6(rate * dim),
    credit_remaining_usd: credit?.ai_credit_remaining ?? null,
    credit_as_of: credit?.ai_credit_as_of ?? null,
    days_of_credit_left:
      rate > 0 && credit?.ai_credit_remaining != null
        ? Math.floor(credit.ai_credit_remaining / rate)
        : null,
    basis: "billing_daily model spend (nightly insights) + manual credit remainder",
  };
}
