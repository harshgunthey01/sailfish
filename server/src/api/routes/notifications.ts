import { Hono } from "hono";
import { getDb } from "../../db/schema.js";
import { resetBlocked } from "../../services/thresholds.js";
import { sendChannel } from "../../services/notifier.js";
import type { Vault } from "../../services/vault.js";

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

  return app;
}
