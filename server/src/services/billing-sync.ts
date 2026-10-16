import { getDb, newId, nowIso } from "../db/schema.js";
import { DOClient } from "../do/client.js";
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
const AI_USAGE_PREFIX = "1-AI-";
const AI_CREDIT_PREFIX = "1-DO-AI";
const TAX_SKU_PREFIX = "1-DO-ADJMT-00TAX";

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
          const sku = (p.sku ?? "").toUpperCase();
          if (sku.startsWith(TAX_SKU_PREFIX)) {
            taxMtd += amount;
          } else if (sku.startsWith(AI_USAGE_PREFIX) || sku.startsWith(AI_CREDIT_PREFIX)) {
            aiUsageMtd += amount;
          } else if (amount < 0) {
            // Credits / generic adjustments — no bucket (they reduce the bill but aren't "core compute")
          } else {
            coreComputeMtd += amount;
          }
        }
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

    const breaches = evaluateThresholds({
      compute_balance: mtd,
      inference_balance: inferenceBalance ?? 0,
      spend_limit: spendLimit,
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
