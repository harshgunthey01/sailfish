import { Hono } from "hono";
import { getDb, newId } from "../../db/schema.js";
import { resetBlocked } from "../../services/thresholds.js";
import { sendChannel } from "../../services/notifier.js";
import { budgetProgress } from "../../services/billing-sync.js";
import {
  getDigestSettings,
  saveDigestSettings,
  sendDigestNow,
  type Frequency,
} from "../../services/digest.js";
import type { Vault } from "../../services/vault.js";

const CHANNELS = ["smtp", "slack", "gchat"] as const;

function parseAlerts(v: unknown): number[] | null {
  const arr = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.split(",")
      : [];
  const nums = arr
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 1000)
    .sort((a, b) => a - b);
  return nums.length ? Array.from(new Set(nums)) : null;
}

function parseChannels(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((c) => (CHANNELS as readonly string[]).includes(String(c))).map(String);
  return Array.from(new Set(out));
}

export function notificationRoutes(vault: Vault): Hono {
  const app = new Hono();

  app.get("/log", (c) => {
    const rows = getDb()
      .prepare("SELECT * FROM notification_log ORDER BY ts DESC LIMIT 100")
      .all();
    return c.json({ log: rows });
  });

  app.get("/thresholds", (c) => {
    return c.json({ thresholds: getDb().prepare("SELECT * FROM thresholds").all() });
  });

  app.post("/test", async (c) => {
    const b = await c.req.json<{ channel?: "smtp" | "slack" | "gchat" }>();
    if (!b.channel) return c.json({ error: "channel required" }, 400);
    const r = await sendChannel(b.channel, "Sailfish test notification.", vault);
    return c.json(r, r.ok ? 200 : 502);
  });

  app.post("/unblock", (c) => {
    resetBlocked();
    return c.json({ ok: true });
  });

  // ---- monthly budget envelopes (MONITORING.md Phase 6) ----
  app.get("/budgets", (c) => c.json(budgetProgress()));

  app.post("/budgets", async (c) => {
    const b = await c.req.json<{
      name?: string;
      scope?: string;
      amount_usd?: number;
      alerts?: unknown;
      channels?: unknown;
    }>();
    if (!b.name?.trim()) return c.json({ error: "name required" }, 400);
    const scope = ["ai", "core", "total"].includes(b.scope ?? "") ? (b.scope as string) : null;
    if (!scope) return c.json({ error: "scope must be ai, core, or total" }, 400);
    if (!Number.isFinite(Number(b.amount_usd)) || Number(b.amount_usd) <= 0)
      return c.json({ error: "amount_usd must be positive" }, 400);
    const alerts = b.alerts === undefined ? [50, 80, 100] : parseAlerts(b.alerts);
    if (!alerts) return c.json({ error: "alerts must be ascending percentages (up to 1000)" }, 400);
    const channels = b.channels === undefined ? ["smtp"] : parseChannels(b.channels);
    if (!channels) return c.json({ error: "channels must be a string array" }, 400);
    const id = newId();
    getDb()
      .prepare(
        `INSERT INTO budgets (id, name, scope, amount_usd, alerts_json, channels_json)
         VALUES (?,?,?,?,?,?)`
      )
      .run(id, b.name.trim(), scope, Number(b.amount_usd), JSON.stringify(alerts), JSON.stringify(channels));
    return c.json({ ok: true, id }, 201);
  });

  app.put("/budgets/:id", async (c) => {
    const b = await c.req.json<{
      amount_usd?: number;
      alerts?: unknown;
      channels?: unknown;
      is_active?: boolean;
    }>();
    const row = getDb().prepare("SELECT id FROM budgets WHERE id = ?").get(c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    const sets: string[] = [];
    const vals: Array<string | number> = [];
    if (b.amount_usd !== undefined) {
      if (!Number.isFinite(Number(b.amount_usd)) || Number(b.amount_usd) <= 0)
        return c.json({ error: "amount_usd must be positive" }, 400);
      sets.push("amount_usd = ?");
      vals.push(Number(b.amount_usd));
    }
    if (b.alerts !== undefined) {
      const alerts = parseAlerts(b.alerts);
      if (!alerts) return c.json({ error: "alerts must be ascending percentages (up to 1000)" }, 400);
      sets.push("alerts_json = ?");
      vals.push(JSON.stringify(alerts));
    }
    if (b.channels !== undefined) {
      const channels = parseChannels(b.channels);
      if (!channels) return c.json({ error: "channels must be a string array" }, 400);
      sets.push("channels_json = ?");
      vals.push(JSON.stringify(channels));
    }
    if (b.is_active !== undefined) {
      sets.push("is_active = ?");
      vals.push(b.is_active ? 1 : 0);
    }
    if (!sets.length) return c.json({ error: "nothing to update" }, 400);
    getDb().prepare(`UPDATE budgets SET ${sets.join(", ")} WHERE id = ?`).run(...vals, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.delete("/budgets/:id", (c) => {
    const r = getDb().prepare("DELETE FROM budgets WHERE id = ?").run(c.req.param("id"));
    return r.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });

  // ---- digest email (MONITORING.md Phase 7) ----
  app.get("/digest", (c) => c.json(getDigestSettings()));

  app.post("/digest", async (c) => {
    const b = await c.req.json<{ enabled?: boolean; frequency?: Frequency }>();
    return c.json({ ok: true, ...saveDigestSettings(b.enabled === true, b.frequency ?? "weekly") });
  });

  app.post("/digest/test", async (c) => {
    const r = await sendDigestNow(vault);
    return c.json(r, r.ok ? 200 : 502);
  });

  return app;
}
