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

  // Host metrics passthrough: ?host_id=&metric=&hours=
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

  // Full core inventory across billable products + idle-waste detection.
  // Every product is fetched independently: one failure never blanks the rest.
  app.get("/inventory", async (c) => {
    const tok = vault.get("do_token");
    if (!tok) return c.json({ error: "DigitalOcean token not configured." }, 400);
    const client = new DOClient(tok, "");
    type Settled = { ok: true; v: any[] } | { ok: false; e: string };
    const settles: Settled[] = await Promise.all([
      client.listDatabases().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listMicrovms().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listK8sClusters().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listApps().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listVolumes().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listSnapshots().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listLoadBalancers().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listReservedIps().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listFunctionNamespaces().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listCdnEndpoints().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listDomains().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
      client.listAgents().then(
        (v) => ({ ok: true as const, v }),
        (e) => ({ ok: false as const, e: String(e) })
      ),
    ]);
    const pick = (i: number): any[] => {
      const s = settles[i];
      return s && s.ok ? s.v : [];
    };
    const errors: Record<string, string> = {};
    const names = [
      "databases", "microvms", "kubernetes", "apps", "volumes", "snapshots",
      "load_balancers", "reserved_ips", "functions", "cdn", "domains", "agents",
    ];
    settles.forEach((s, i) => {
      if (!s.ok) errors[names[i] ?? `product_${i}`] = s.e;
    });
    const volumes = pick(4);
    const snapshots = pick(5);
    const ips = pick(7);
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    return c.json({
      databases: pick(0),
      microvms: pick(1),
      kubernetes: pick(2),
      apps: pick(3),
      volumes,
      snapshots,
      load_balancers: pick(6),
      reserved_ips: ips,
      functions: pick(8),
      cdn: pick(9),
      domains: pick(10),
      agents: pick(11),
      waste: {
        detached_volumes: volumes.filter((v: any) => (v.attached_to ?? []).length === 0),
        old_snapshots: snapshots.filter((s: any) => (s.created_at ?? "") < cutoff),
        unattached_ips: ips.filter((r: any) => !r.attached_to),
      },
      errors,
      source: "live",
    });
  });

  return app;
}
