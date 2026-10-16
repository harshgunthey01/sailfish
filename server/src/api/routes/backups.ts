import { Hono } from "hono";
import fs from "node:fs";
import {
  listBackups,
  createBackup,
  stageRestore,
  pendingRestore,
  cancelRestore,
  safePath,
  getBackupSchedule,
  saveBackupSchedule,
} from "../../services/backup.js";
import {
  getS3Settings,
  saveS3Settings,
  testS3,
  listRemote,
  fetchRemote,
  uploadIfConfigured,
} from "../../services/s3.js";
import type { Vault } from "../../services/vault.js";

/** SQLite backup & restore (protected: admin session + completed setup). */
export function backupRoutes(vault: Vault, dataDir: string): Hono {
  const app = new Hono();

  app.get("/", (c) =>
    c.json({ backups: listBackups(dataDir), pending: pendingRestore(dataDir) })
  );

  app.post("/", async (c) => {
    try {
      const b = createBackup(dataDir);
      const s3 = await uploadIfConfigured(vault, dataDir, b.file);
      return c.json({ ok: true, backup: b, s3 }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/:file/download", (c) => {
    const p = safePath(dataDir, c.req.param("file"));
    if (!p) return c.json({ error: "unknown backup file" }, 404);
    const buf = fs.readFileSync(p);
    return c.body(new Uint8Array(buf), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${c.req.param("file")}"`,
    });
  });

  app.post("/:file/restore", (c) => {
    try {
      const { safety } = stageRestore(dataDir, c.req.param("file"));
      return c.json({ ok: true, restart_required: true, safety: safety.file });
    } catch (e) {
      const missing = e instanceof Error && /unknown backup/.test(e.message);
      return c.json({ error: e instanceof Error ? e.message : String(e) }, missing ? 404 : 500);
    }
  });

  app.delete("/:file", (c) => {
    const p = safePath(dataDir, c.req.param("file"));
    if (!p) return c.json({ error: "unknown backup file" }, 404);
    fs.unlinkSync(p);
    return c.json({ ok: true });
  });

  app.delete("/pending/restore", (c) => c.json({ ok: cancelRestore(dataDir) }));

  // ---- schedule + S3 destination ----
  app.get("/config", (c) =>
    c.json({ schedule: getBackupSchedule(), s3: getS3Settings(vault) })
  );

  app.post("/config", async (c) => {
    const b = await c.req.json<{
      enabled?: boolean;
      frequency?: string;
      hour_utc?: number;
      s3?: {
        endpoint?: string;
        bucket?: string;
        region?: string;
        prefix?: string;
        path_style?: boolean;
        access_key?: string;
        secret_key?: string;
      };
    }>();
    try {
      const schedule =
        b.enabled !== undefined || b.frequency !== undefined || b.hour_utc !== undefined
          ? saveBackupSchedule({
              ...(b.enabled !== undefined ? { enabled: !!b.enabled } : {}),
              ...(b.frequency !== undefined
                ? { frequency: b.frequency as "daily" | "weekly" }
                : {}),
              ...(b.hour_utc !== undefined ? { hour_utc: b.hour_utc } : {}),
            })
          : getBackupSchedule();
      const s3 = b.s3 ? saveS3Settings(vault, b.s3) : getS3Settings(vault);
      return c.json({ ok: true, schedule, s3 });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  app.post("/s3/test", async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const hasOverride = b && typeof b === "object" && ["endpoint", "bucket", "access_key", "secret_key"].some((k) => (b as any)[k]);
    const r = await testS3(vault, hasOverride ? (b as any) : undefined);
    return c.json(r, r.ok ? 200 : 502);
  });

  app.get("/s3", async (c) => {
    try {
      return c.json({ objects: await listRemote(vault) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  app.post("/s3/fetch", async (c) => {
    const b = await c.req.json<{ key?: string }>();
    if (!b.key) return c.json({ error: "key required" }, 400);
    try {
      const r = await fetchRemote(vault, dataDir, b.key);
      return c.json({ ok: true, ...r });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  return app;
}
