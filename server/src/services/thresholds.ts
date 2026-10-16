import { getDb, newId, nowIso } from "../db/schema.js";

export interface ThresholdContext {
  compute_balance: number;
  inference_balance: number;
  spend_limit: number | null;
  /** Today's AI-model spend (USD, billing_daily model buckets). */
  daily_spend_usd?: number | null;
  /** Today's spend ÷ prior-7-day mean (null when no baseline). */
  daily_spend_spike?: number | null;
}

type Channel = "smtp" | "slack" | "gchat";

/**
 * Evaluate user-defined billing thresholds after each sync (PRD §2.2).
 * Breach => is_blocked + notifier fan-out handled by caller.
 */
export function evaluateThresholds(ctx: ThresholdContext): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM thresholds WHERE is_active = 1")
    .all() as any[];
  const breached: string[] = [];

  for (const t of rows) {
    const actual =
      t.metric === "compute_balance"
        ? ctx.compute_balance
        : t.metric === "inference_balance"
          ? ctx.inference_balance
          : t.metric === "daily_spend_usd"
            ? (ctx.daily_spend_usd ?? null)
            : t.metric === "daily_spend_spike"
              ? (ctx.daily_spend_spike ?? null)
              : ctx.spend_limit !== null
                ? (ctx.inference_balance / Math.max(ctx.spend_limit, 0.000001)) * 100
                : null;
    if (actual === null || actual === undefined) continue;

    const hit = t.operator === "gt" ? actual > t.value : actual < t.value;
    if (!hit) continue;

    // cooldown dedupe
    if (t.last_triggered_at) {
      const next = new Date(t.last_triggered_at).getTime() + t.cooldown_minutes * 60_000;
      if (Date.now() < next) continue;
    }

    db.prepare("UPDATE thresholds SET last_triggered_at = ? WHERE id = ?").run(nowIso(), t.id);
    breached.push(`${t.name}: ${t.metric} ${t.operator === "gt" ? ">" : "<"} threshold (${actual.toFixed(2)} vs ${t.value})`);
  }

  if (breached.length > 0) {
    db.prepare("UPDATE billing_state SET is_blocked = 1 WHERE id = 'singleton'").run();
  }
  return breached;
}

export async function notifyBreaches(breaches: string[], send: (channel: Channel, msg: string) => Promise<{ ok: boolean; detail: string }>) {
  if (breaches.length === 0) return;
  const db = getDb();
  const channels = db
    .prepare("SELECT channels_json FROM thresholds WHERE is_active = 1")
    .all()
    .flatMap((r: any) => {
      try {
        return JSON.parse(r.channels_json) as Channel[];
      } catch {
        return [] as Channel[];
      }
    });
  const unique = Array.from(new Set(channels));
  const msg = `⚠️ Sailfish billing threshold breached:\n- ${breaches.join("\n- ")}`;

  for (const ch of unique) {
    let result = { ok: false, detail: "not attempted" };
    try {
      result = await send(ch, msg);
    } catch (e) {
      result = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    db.prepare(
      "INSERT INTO notification_log (id, channel, event, status, detail) VALUES (?,?,?,?,?)"
    ).run(newId(), ch, "threshold_breach", result.ok ? "sent" : "failed", result.detail);
  }
}

export function resetBlocked() {
  getDb().prepare("UPDATE billing_state SET is_blocked = 0 WHERE id = 'singleton'").run();
}
