import { Hono } from "hono";
import { DOClient, DOError } from "../../do/client.js";
import { coreAttribution } from "../../services/billing-sync.js";
import type { Vault } from "../../services/vault.js";

/**
 * Core-compute inventory (MONITORING.md Phase 5). Read-only: droplet list +
 * honest cost attribution. No power actions — none exist on purpose.
 */
export function infrastructureRoutes(vault: Vault): Hono {
  const app = new Hono();

  app.get("/summary", async (c) => {
    const tok = vault.get("do_token");
    if (!tok) return c.json({ error: "DigitalOcean token not configured." }, 400);
    try {
      const client = new DOClient(tok, "");
      const droplets = await client.listDroplets();
      return c.json({ droplets, ...coreAttribution(droplets), source: "live" });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e), code: "do_error" },
        502
      );
    }
  });

  // Host metrics passthrough: ?host_id=&metric=cpu|memory|load_*|disk_*&hours=24
  app.get("/metrics", async (c) => {
    const tok = vault.get("do_token");
    if (!tok) return c.json({ error: "DigitalOcean token not configured." }, 400);
    const hostId = c.req.query("host_id") ?? "";
    const metric = c.req.query("metric") ?? "cpu";
    const hours = Math.min(Math.max(parseInt(c.req.query("hours") ?? "24", 10) || 24, 1), 168);
    if (!hostId) return c.json({ error: "host_id required" }, 400);
    try {
      const client = new DOClient(tok, "");
      const now = Math.floor(Date.now() / 1000);
      const data = await client.dropletMetrics(hostId, metric, String(now - hours * 3600), String(now));
      return c.json({ metric, host_id: hostId, hours, data });
    } catch (e) {
      const status = e instanceof DOError ? e.status : 502;
      return c.json(
        { error: e instanceof Error ? e.message : String(e), code: "do_error" },
        status as 400 | 502
      );
    }
  });

  return app;
}
