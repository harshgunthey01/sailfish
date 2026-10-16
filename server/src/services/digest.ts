import { getDb } from "../db/schema.js";
import {
  forecastSummary,
  cacheSummary,
  dailySpike,
} from "./billing-sync.js";
import { loadNotificationSettings, sendEmail, logNotification } from "./notifier.js";
import type { Vault } from "./vault.js";

/**
 * Digest email (MONITORING.md Phase 7): plaintext Sunday-or-chosen-cadence
 * summary built entirely from existing endpoints/functions. Customer-chosen
 * cadence via a persisted next_due date evaluated on a daily tick.
 */

export type Frequency = "daily" | "weekly" | "biweekly" | "bimonthly";
const FREQUENCIES: Frequency[] = ["daily", "weekly", "biweekly", "bimonthly"];

export interface DigestSettings {
  enabled: boolean;
  frequency: Frequency;
  next_due: string | null; // YYYY-MM-DD
}

function readRaw(): any {
  try {
    const row = getDb()
      .prepare("SELECT settings_json FROM app_extras WHERE id='singleton'")
      .get() as any;
    return row ? (JSON.parse(row.settings_json)?.digest ?? {}) : {};
  } catch {
    return {};
  }
}

export function getDigestSettings(): DigestSettings {
  const d = readRaw();
  const frequency: Frequency = FREQUENCIES.includes(d.frequency) ? d.frequency : "weekly";
  return {
    enabled: d.enabled === true,
    frequency,
    next_due: typeof d.next_due === "string" ? d.next_due : null,
  };
}

function advance(dateStr: string, freq: Frequency): string {
  const [y = 1970, m = 1, dd = 1] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd));
  if (freq === "bimonthly") d.setUTCMonth(d.getUTCMonth() + 2);
  else d.setUTCDate(d.getUTCDate() + (freq === "daily" ? 1 : freq === "weekly" ? 7 : 14));
  return d.toISOString().slice(0, 10);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function persist(patch: Partial<{ enabled: boolean; frequency: Frequency; next_due: string | null }>) {
  const db = getDb();
  let settings: any = {};
  try {
    const row = db.prepare("SELECT settings_json FROM app_extras WHERE id='singleton'").get() as any;
    settings = row ? JSON.parse(row.settings_json) : {};
  } catch {
    settings = {};
  }
  settings.digest = { ...(settings.digest ?? {}), ...patch };
  db.prepare("UPDATE app_extras SET settings_json = ? WHERE id='singleton'").run(
    JSON.stringify(settings)
  );
}

export function saveDigestSettings(
  enabled: boolean,
  frequency: Frequency
): DigestSettings {
  const freq: Frequency = FREQUENCIES.includes(frequency) ? frequency : "weekly";
  // First enable (or frequency change): start counting from today.
  const due = enabled ? advance(todayUtc(), freq) : getDigestSettings().next_due;
  persist({ enabled, frequency: freq, next_due: due });
  return getDigestSettings();
}

function adminEmail(): string | null {
  const row = getDb().prepare("SELECT email FROM admins LIMIT 1").get() as
    | { email: string }
    | undefined;
  return row?.email ?? null;
}

/** Assemble the digest body from existing sources. Pure read. */
export function buildDigest(): string {
  const db = getDb();
  const date = todayUtc();
  const s = db.prepare("SELECT ai_usage_mtd, core_compute_mtd, tax_mtd FROM billing_state WHERE id='singleton'").get() as any;
  const ai = s?.ai_usage_mtd ?? 0;
  const core = s?.core_compute_mtd ?? 0;
  const tax = s?.tax_mtd ?? 0;
  const lines: string[] = [`Sailfish digest — ${date}`, ""];

  lines.push(`Month-to-date: AI $${ai.toFixed(2)} · core $${core.toFixed(2)} · tax $${tax.toFixed(2)}`);
  const prior = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total FROM billing_daily
       WHERE day < date('now', 'start of month') AND model_key NOT IN ('tax','credit','ai_credit_purchase')`
    )
    .get() as { total: number };
  lines.push(
    prior.total > 0
      ? `Prior months tracked total (models): $${prior.total.toFixed(2)}`
      : "Prior-month comparison: insufficient history yet."
  );
  lines.push("");

  // top model 7d + biggest mover vs prior 7d
  const share = (fromMod: string, toMod: string) => {
    const rows = db
      .prepare(
        `SELECT model_key, COALESCE(SUM(amount_usd), 0) AS total FROM billing_daily
         WHERE day >= date('now', ?) AND day < date('now', ?) AND model_key NOT IN ('tax','credit','ai_credit_purchase')
         GROUP BY model_key`
      )
      .all(fromMod, toMod) as Array<{ model_key: string; total: number }>;
    const tot = rows.reduce((x, r) => x + r.total, 0);
    return { rows, tot };
  };
  const cur = share("-7 days", "0 days");
  const prev = share("-14 days", "-7 days");
  if (cur.tot > 0) {
    const sorted = [...cur.rows].sort((a, b) => b.total - a.total);
    const top = sorted[0];
    if (top) {
      lines.push(`Top model (7d): ${top.model_key} $${top.total.toFixed(2)} (${((top.total / cur.tot) * 100).toFixed(0)}% of model spend)`);
      const pm = Object.fromEntries(prev.rows.map((r) => [r.model_key, r.total / Math.max(prev.tot, 1e-9)]));
      let mover: string | null = null;
      let swing = 0;
      for (const r of cur.rows) {
        const d = r.total / cur.tot - (pm[r.model_key] ?? 0);
        if (Math.abs(d) > Math.abs(swing)) {
          swing = d;
          mover = r.model_key;
        }
      }
      if (mover) lines.push(`Biggest mover: ${mover} (${swing >= 0 ? "+" : ""}${(swing * 100).toFixed(0)} pts share)`);
    }
  } else {
    lines.push("Top model (7d): no model spend recorded.");
  }
  lines.push("");

  const f = forecastSummary();
  lines.push(
    `Forecast: ≈ $${f.daily_rate_usd.toFixed(2)}/day → $${f.projected_month_end_usd.toFixed(2)} by ${f.month}-${String(f.days_in_month).padStart(2, "0")}`
  );
  lines.push(
    f.days_of_credit_left != null
      ? `Credit: $${f.credit_remaining_usd} left (as of ${f.credit_as_of}) ≈ ${f.days_of_credit_left} days`
      : "Credit: set AI credit in Settings for days-left."
  );
  lines.push("");

  const ch = cacheSummary(7);
  lines.push(
    ch.overall.hit_ratio != null
      ? `Cache (7d): ${(ch.overall.hit_ratio * 100).toFixed(1)}% hit · ≈ $${ch.overall.est_savings_usd.toFixed(2)} saved`
      : "Cache (7d): no cache data."
  );
  const spike = dailySpike(db);
  lines.push(
    spike.ratio != null
      ? `Spend pace: today $${spike.today.toFixed(2)} vs 7d baseline ×${spike.ratio.toFixed(2)}`
      : "Spend pace: no baseline yet."
  );
  const fired = db
    .prepare(
      `SELECT event, status, detail, ts FROM notification_log
       WHERE event = 'threshold_breach' AND ts >= datetime('now', '-7 days')
       ORDER BY ts DESC LIMIT 5`
    )
    .all() as any[];
  lines.push(fired.length ? `Alerts fired (7d): ${fired.length}` : "Alerts fired (7d): none");
  for (const n of fired) lines.push(`  - ${n.detail}`);
  lines.push("", "— Sailfish");
  return lines.join("\n");
}

/** Daily tick: send when due, advance the schedule. Never throws. */
export async function checkDigestDue(vault: Vault): Promise<{ sent: boolean; detail: string }> {
  try {
    const s = getDigestSettings();
    if (!s.enabled) return { sent: false, detail: "digest disabled" };
    if (!s.next_due || todayUtc() < s.next_due)
      return { sent: false, detail: `not due (next ${s.next_due ?? "unset"})` };
    const email = adminEmail();
    if (!email) return { sent: false, detail: "no admin email" };
    const settings = loadNotificationSettings();
    if (!settings.smtp) {
      logNotification("smtp", "digest", "skipped", "smtp not configured");
      return { sent: false, detail: "smtp not configured" };
    }
    const r = await sendEmail(vault, email, `Sailfish digest — ${todayUtc()}`, buildDigest());
    logNotification("smtp", "digest", r.ok ? "sent" : "failed", r.detail);
    if (r.ok) persist({ next_due: advance(s.next_due, s.frequency) });
    return { sent: r.ok, detail: r.detail };
  } catch (e) {
    return { sent: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Immediate test send (does not consume the scheduled slot). */
export async function sendDigestNow(vault: Vault): Promise<{ ok: boolean; detail: string }> {
  const email = adminEmail();
  if (!email) return { ok: false, detail: "no admin email" };
  const r = await sendEmail(vault, email, `Sailfish digest (test) — ${todayUtc()}`, buildDigest());
  logNotification("smtp", "digest_test", r.ok ? "sent" : "failed", r.detail);
  return r;
}
