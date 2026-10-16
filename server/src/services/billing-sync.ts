import { getDb, newId, nowIso } from "../db/schema.js";
import { DOClient } from "../do/client.js";
import type { Vault } from "./vault.js";
import { evaluateThresholds } from "./thresholds.js";
import { notifyBreaches } from "./thresholds.js";
import { sendChannel } from "./notifier.js";

/**
 * Billing sync (PRD §2.2, ARCHITECTURE §6.2).
 * Pulls core-compute accrued balance + prepaid inference balance and upserts the
 * billing_state singleton; appends billing_history for charts; then evaluates
 * user thresholds.
 */

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

    // inference remaining = prepaid - used (fall back to raw fields if shape differs)
    let inferenceBalance: number | null = null;
    let spendLimit: number | null = null;
    if (prepay) {
      if (prepay.prepaid_amount !== undefined && prepay.used_amount !== undefined) {
        inferenceBalance = round6(prepay.prepaid_amount - prepay.used_amount);
      }
      spendLimit = prepay.spend_limit ?? null;
    }

    const ts = nowIso();
    db.prepare(
      `UPDATE billing_state SET compute_balance = ?, inference_balance = ?, last_synced = ? WHERE id = 'singleton'`
    ).run(bal.month_to_date_balance, inferenceBalance ?? 0, ts);

    db.prepare(
      `INSERT INTO billing_history (id, ts, compute_balance, inference_balance, spend_limit) VALUES (?,?,?,?,?)`
    ).run(newId(), ts, bal.month_to_date_balance, inferenceBalance ?? 0, spendLimit);

    // keep history bounded: 90 days
    db.prepare(
      `DELETE FROM billing_history WHERE ts < datetime('now', '-90 days')`
    ).run();

    const breaches = evaluateThresholds({
      compute_balance: bal.month_to_date_balance,
      inference_balance: inferenceBalance ?? 0,
      spend_limit: spendLimit,
    });
    if (breaches.length > 0) {
      void notifyBreaches(breaches, (ch, msg) => sendChannel(ch, msg, vault));
    }

    return {
      ok: true,
      detail: "synced",
      compute_balance: bal.month_to_date_balance,
      inference_balance: inferenceBalance ?? 0,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, detail };
  }
}

export function billingSummary() {
  const db = getDb();
  const state = db.prepare("SELECT * FROM billing_state WHERE id='singleton'").get() as any;
  const recent = db
    .prepare(
      `SELECT ts, compute_balance, inference_balance, spend_limit FROM billing_history
       ORDER BY ts DESC LIMIT 500`
    )
    .all();
  return { state, history: recent.reverse() };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
