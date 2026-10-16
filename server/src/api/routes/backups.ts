import { Hono } from "hono";
import fs from "node:fs";
import {
  listBackups,
  createBackup,
  stageRestore,
  pendingRestore,
  cancelRestore,
  safePath,
} from "../../services/backup.js";

/** SQLite backup & restore (protected: admin session + completed setup). */
export function backupRoutes(dataDir: string): Hono {
  const app = new Hono();

  app.get("/", (c) =>
    c.json({ backups: listBackups(dataDir), pending: pendingRestore(dataDir) })
  );

  app.post("/", (c) => {
    try {
      return c.json({ ok: true, backup: createBackup(dataDir) }, 201);
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

  return app;
}
