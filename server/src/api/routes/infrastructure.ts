import { Hono } from "hono";
import { DOClient } from "../../do/client.js";
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

  return app;
}
