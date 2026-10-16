import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb } from "./db/schema.js";
import { Vault } from "./services/vault.js";
import { sessionAdminId } from "./auth/admin.js";
import { setupRoutes } from "./api/routes/setup.js";
import { billingRoutes, telemetryRoutes } from "./api/routes/billing.js";
import { routerRoutes } from "./api/routes/router.js";
import { modelRouterRoutes } from "./api/routes/model-routers.js";
import { modelRoutes } from "./api/routes/models.js";
import { backupRoutes } from "./api/routes/backups.js";
import { notificationRoutes } from "./api/routes/notifications.js";
import { scheduleEvery, scheduleDaily } from "./services/scheduler.js";
import { applyPendingRestore, createBackup, listBackups } from "./services/backup.js";
import { syncBilling } from "./services/billing-sync.js";
import { notifyBreaches } from "./services/thresholds.js";
import { sendChannel } from "./services/notifier.js";
import { pruneTelemetry } from "./services/telemetry.js";
import { makeClient } from "./services/billing-sync.js";
import { listJobs, processModelJob } from "./services/model-manager.js";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
const PORT = parseInt(process.env.PORT ?? "8080", 10);

function log(obj: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}

async function main() {
  // A staged restore replaces the DB file BEFORE it is opened.
  const restored = applyPendingRestore(DATA_DIR);
  if (restored) log({ event: "restore-applied", file: restored });

  initDb(DATA_DIR);
  const vault = new Vault(DATA_DIR);

  const app = new Hono({ strict: false });

  // ---- health (unauthenticated, for uptime watchers) ----
  app.get("/api/v1/health", (c) => {
    const s = getDb().prepare("SELECT setup_complete, last_synced FROM app_settings, billing_state WHERE app_settings.id='singleton'").get() as any;
    return c.json({ ok: true, setup_complete: !!s.setup_complete, last_synced: s.last_synced });
  });

  // ---- setup wizard (has its own internal gating) ----
  app.route("/api/v1/setup", setupRoutes(vault));

  // ---- telemetry ingest is keyed, not cookie-authed ----
  app.route("/api/v1/telemetry", telemetryRoutes(vault));

  // ---- everything else requires an admin session + completed setup ----
  const protectedApp = new Hono();
  protectedApp.use("*", async (c, next) => {
    const m = (c.req.header("Cookie") ?? "").match(/sf_session=([^;]+)/);
    if (!sessionAdminId(m?.[1])) {
      c.status(401);
      return c.json({ error: "unauthenticated", redirect: "/setup" });
    }
    const s = getDb().prepare("SELECT setup_complete FROM app_settings WHERE id='singleton'").get() as any;
    if (!s.setup_complete) {
      c.status(403);
      return c.json({ error: "setup incomplete", redirect: "/setup" });
    }
    await next();
  });
  protectedApp.route("/billing", billingRoutes(vault));
  protectedApp.route("/router", routerRoutes());
  protectedApp.route("/model-routers", modelRouterRoutes(vault));
  protectedApp.route("/models", modelRoutes(vault));
  protectedApp.route("/notifications", notificationRoutes(vault));
  protectedApp.route("/backups", backupRoutes(DATA_DIR));
  app.route("/api/v1", protectedApp);

  // ---- static SPA ----
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = process.env.WEB_DIST
    ? path.resolve(process.env.WEB_DIST)
    : path.resolve(here, "../../web/dist");
  if (fs.existsSync(webDist)) {
    app.use("/*", serveStatic({ root: relativeRoot(webDist), rewriteRequestPath: (p) => p }));
    app.get("*", (c, next) => {
      if (c.req.path.startsWith("/api/")) return next();
      return serveStatic({ root: relativeRoot(webDist), path: "index.html" })(c, next);
    });
  } else {
    app.get("/", (c) => c.json({ hint: "web dist not built; run npm run build in web/ or set WEB_DIST" }));
  }

  // ---- background work (only after setup) ----
  const isSetup = () =>
    (getDb().prepare("SELECT setup_complete FROM app_settings WHERE id='singleton'").get() as any)
      .setup_complete === 1;

  scheduleEvery("billing-sync", 5 * 60_000, async () => {
    if (!isSetup()) return;
    const r = await syncBilling(vault);
    log({ task: "billing-sync", ...r });
  });

  scheduleDaily("prune", 4, () => {
    pruneTelemetry();
    log({ task: "prune", detail: "ok" });
  });

  // Daily automated backup (03:00) + one at boot if none in the last 24h.
  const bootBackup = () => {
    try {
      const latest = listBackups(DATA_DIR)[0];
      const stale =
        !latest || Date.now() - new Date(latest.created_at).getTime() > 24 * 3600_000;
      if (stale) {
        const b = createBackup(DATA_DIR);
        log({ task: "backup", detail: "ok", file: b.file, when: "boot" });
      }
    } catch (e) {
      log({ task: "backup", detail: e instanceof Error ? e.message : String(e) });
    }
  };
  bootBackup();
  scheduleDaily("backup", 3, () => {
    try {
      const b = createBackup(DATA_DIR);
      log({ task: "backup", detail: "ok", file: b.file, when: "scheduled" });
    } catch (e) {
      log({ task: "backup", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  // resume stuck jobs on boot
  for (const j of listJobs(10)) {
    if (j.status === "pending" || j.status === "running") {
      void processModelJob(j.id, makeClient(vault));
    }
  }

  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
    log({ event: "listening", port: info.port, data_dir: DATA_DIR });
  });
}

function relativeRoot(abs: string): string {
  // serveStatic root is relative to cwd
  return path.relative(process.cwd(), abs) || ".";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
