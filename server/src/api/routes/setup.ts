import { Hono } from "hono";
import crypto from "node:crypto";
import { getDb, newId } from "../../db/schema.js";
import {
  adminExists,
  createAdmin,
  createSession,
  verifyAdmin,
  sessionAdminId,
  destroySession,
  destroySessionsForAdmin,
  hashPassword,
} from "../../auth/admin.js";
import { sendTestEmail, sendEmail, logNotification } from "../../services/notifier.js";
import {
  backupDir,
  backupFileName,
  acceptBackupFile,
  stageRestore,
} from "../../services/backup.js";
import { buildClient, listRemote, fetchRemote, saveS3Settings } from "../../services/s3.js";
import fs from "node:fs";
import path from "node:path";
import type { Vault } from "../../services/vault.js";
import { DOClient } from "../../do/client.js";

export function setupRoutes(vault: Vault, dataDir: string): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    const s = getDb().prepare("SELECT * FROM app_settings WHERE id='singleton'").get() as any;
    return c.json({
      setup_complete: !!s.setup_complete,
      admin_created: adminExists(),
      smtp_configured: !!s.smtp_configured,
      do_auth_configured: !!s.do_auth_configured,
    });
  });

  // Step 1: admin account
  app.post("/admin", async (c) => {
    if (adminExists()) return c.json({ error: "admin already exists" }, 409);
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim() ?? "";
    const password = body.password ?? "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: "invalid email" }, 400);
    if (password.length < 8) return c.json({ error: "password must be ≥ 8 chars" }, 400);
    const adminId = createAdmin(email, password);
    const session = createSession(adminId);
    c.header("Set-Cookie", session.cookie);
    return c.json({ ok: true });
  });

  app.post("/login", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const adminId = verifyAdmin(body.email ?? "", body.password ?? "");
    if (!adminId) return c.json({ error: "invalid credentials" }, 401);
    const session = createSession(adminId);
    c.header("Set-Cookie", session.cookie);
    return c.json({ ok: true });
  });

  app.post("/logout", (c) => {
    const cookie = c.req.header("Cookie") ?? "";
    const m = cookie.match(/sf_session=([^;]+)/);
    if (m) destroySession(m[1]!);
    c.header("Set-Cookie", "sf_session=; Path=/; HttpOnly; Max-Age=0");
    return c.json({ ok: true });
  });

  app.get("/me", (c) => {    const m = (c.req.header("Cookie") ?? "").match(/sf_session=([^;]+)/);
    const adminId = sessionAdminId(m?.[1]);
    if (!adminId) return c.json({ authenticated: false });
    const admin = getDb().prepare("SELECT email FROM admins WHERE id=?").get(adminId) as {
      email: string;
    };
    return c.json({ authenticated: true, email: admin.email });
  });

  // Password recovery via emailed reset link (public).
  // Always returns ok:true so the endpoint can't be used to enumerate accounts.
  // Requires SMTP to be configured; otherwise the email silently can't go out
  // (see server log) — configure it in Settings → Notifications while logged in.
  app.post("/password/forgot", async (c) => {
    const body = await c.req.json<{ email?: string }>();
    const email = (body.email ?? "").trim().toLowerCase();
    const admin = email
      ? (getDb().prepare("SELECT id, email FROM admins WHERE email = ?").get(email) as
          | { id: string; email: string }
          | undefined)
      : undefined;
    if (admin) {
      const db = getDb();
      db.prepare("DELETE FROM password_resets WHERE admin_id = ?").run(admin.id);
      db.prepare("DELETE FROM password_resets WHERE expires_at < datetime('now')").run();
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      db.prepare(
        "INSERT INTO password_resets (id, admin_id, token_hash, expires_at) VALUES (?,?,?,datetime('now','+15 minutes'))"
      ).run(newId(), admin.id, tokenHash);
      const proto = c.req.header("x-forwarded-proto") ?? "http";
      const host =
        c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost:9000";
      const link = `${proto}://${host}/reset?token=${token}`;
      const r = await sendEmail(
        vault,
        admin.email,
        "Sailfish password reset",
        `A password reset was requested for your Sailfish admin account.\n\nSet a new password (link expires in 15 minutes, single use):\n${link}\n\nIf you did not request this, ignore this email.`
      );
      logNotification("smtp", "password_reset", r.ok ? "sent" : "failed", r.detail);
      if (!r.ok) console.warn("[setup] password-reset email failed:", r.detail);
    }
    return c.json({ ok: true });
  });

  // Consume a reset token: single-use, 15-minute expiry, kills all sessions.
  app.post("/password/reset", async (c) => {
    const body = await c.req.json<{ token?: string; new_password?: string }>();
    if ((body.new_password ?? "").length < 8)
      return c.json({ error: "new password must be ≥ 8 chars" }, 400);
    const tokenHash = body.token
      ? crypto.createHash("sha256").update(String(body.token)).digest("hex")
      : "";
    // Expiry is compared inside SQLite (its datetime('now') is UTC, matching how
    // expires_at was written). Parsing the "YYYY-MM-DD HH:MM:SS" string in JS
    // would interpret it as *local* time and wrongly expire tokens east of UTC.
    const row = getDb()
      .prepare(
        "SELECT id, admin_id FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')"
      )
      .get(tokenHash) as { id: string; admin_id: string } | undefined;
    if (!row) return c.json({ error: "invalid or expired link" }, 400);
    getDb()
      .prepare("UPDATE admins SET password_hash = ? WHERE id = ?")
      .run(hashPassword(body.new_password!), row.admin_id);
    getDb().prepare("UPDATE password_resets SET used = 1 WHERE id = ?").run(row.id);
    destroySessionsForAdmin(row.admin_id);
    logNotification("smtp", "password_reset", "done", "password changed via reset link");
    return c.json({ ok: true });
  });

  // Disaster recovery during onboarding: upload a backup file or fetch one
  // from S3, then restart to apply. Public ONLY while setup is incomplete —
  // afterwards restores move behind the admin session (Settings → Backups).
  function setupIncomplete(c: any): boolean {
    const s = getDb().prepare("SELECT setup_complete FROM app_settings WHERE id='singleton'").get() as any;
    if (s?.setup_complete) {
      c.status(403);
      return false;
    }
    return true;
  }

  const SETUP_DONE = () =>
    ({ error: "restore is only available before setup completes; use Settings → Backups afterwards" });

  app.post("/restore/upload", async (c) => {
    if (!setupIncomplete(c)) return c.json(SETUP_DONE(), 403);
    let file: File | undefined;
    try {
      const body = await c.req.parseBody();
      const v = body["backup"];
      if (v instanceof File) file = v;
    } catch {
      /* fall through to 400 */
    }
    if (!file) return c.json({ error: "multipart field 'backup' (.db file) required" }, 400);
    if (file.size > 100 * 1024 * 1024) return c.json({ error: "file too large (max 100MB)" }, 413);
    if (file.size < 100) return c.json({ error: "file is empty" }, 400);
    const name = backupFileName();
    const full = path.join(backupDir(dataDir), name);
    fs.writeFileSync(full, Buffer.from(await file.arrayBuffer()));
    const check = acceptBackupFile(full);
    if (!check.ok) {
      try {
        fs.unlinkSync(full);
      } catch {
        /* best effort */
      }
      return c.json({ error: "rejected: " + check.detail }, 400);
    }
    const { safety } = stageRestore(dataDir, name);
    return c.json({ ok: true, file: name, safety: safety.file, restart_required: true }, 201);
  });

  function s3Override(body: any): any {
    const o: any = {};
    for (const k of ["endpoint", "bucket", "region", "access_key", "secret_key", "prefix", "path_style"]) {
      if (body?.[k] !== undefined) o[k] = body[k];
    }
    return o;
  }

  app.post("/restore/s3-list", async (c) => {
    if (!setupIncomplete(c)) return c.json(SETUP_DONE(), 403);
    const body = await c.req.json().catch(() => ({}));
    try {
      const { client, cfg } = buildClient(body);
      return c.json({ objects: await listRemote(client, cfg) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  app.post("/restore/s3-fetch", async (c) => {
    if (!setupIncomplete(c)) return c.json(SETUP_DONE(), 403);
    const body = await c.req.json().catch(() => ({}));
    if (!body?.key) return c.json({ error: "key required" }, 400);
    try {
      const { cfg } = buildClient(body);
      const r = await fetchRemote(vault, dataDir, body.key, cfg);
      const full = path.join(backupDir(dataDir), r.file);
      const check = acceptBackupFile(full);
      if (!check.ok) {
        try {
          fs.unlinkSync(full);
        } catch {
          /* best effort */
        }
        return c.json({ error: "rejected: " + check.detail }, 400);
      }
      if (body.save_credentials) {
        saveS3Settings(vault, {
          endpoint: cfg.endpoint,
          bucket: cfg.bucket,
          region: cfg.region,
          prefix: cfg.prefix,
          path_style: cfg.path_style,
          access_key: body.access_key,
          secret_key: body.secret_key,
        });
      }
      const { safety } = stageRestore(dataDir, r.file);
      return c.json({ ok: true, file: r.file, safety: safety.file, restart_required: true }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  // auth gate for remaining setup steps
  const gated = new Hono();
  gated.use("*", async (c, next) => {
    const m = (c.req.header("Cookie") ?? "").match(/sf_session=([^;]+)/);
    if (!sessionAdminId(m?.[1])) {
      c.status(401);
      return c.json({ error: "unauthenticated" });
    }
    await next();
  });

  // Step 2: SMTP + webhooks + thresholds
  // Non-secret snapshot of the saved notification settings (secrets stay in the vault).
  gated.get("/smtp", (c) => {
    const db = getDb();
    const row = db
      .prepare("SELECT settings_json FROM app_extras WHERE id='singleton'")
      .get() as any;
    let settings: any = {};
    try {
      settings = row ? JSON.parse(row.settings_json) : {};
    } catch {
      settings = {};
    }
    const s = db.prepare("SELECT smtp_configured FROM app_settings WHERE id='singleton'").get() as any;
    return c.json({
      configured: !!s?.smtp_configured,
      host: settings.smtp?.host ?? "",
      port: settings.smtp?.port ?? 587,
      username: settings.smtp?.username ?? "",
      from: settings.smtp?.from ?? "",
      secure: settings.smtp?.secure ?? false,
      has_password: !!vault.get("smtp_password"),
      slack_webhook: settings.slack_webhook ?? "",
      gchat_webhook: settings.gchat_webhook ?? "",
    });
  });

  gated.post("/smtp", async (c) => {
    const body = await c.req.json<{
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      from?: string;
      secure?: boolean;
      slack_webhook?: string;
      gchat_webhook?: string;
    }>();
    if (!body.host || !body.port) return c.json({ error: "host and port required" }, 400);
    if (body.password) vault.set("smtp_password", body.password);
    const db = getDb();
    const row = db.prepare("SELECT settings_json FROM app_extras WHERE id='singleton'").get() as any;
    const settings = JSON.parse(row.settings_json);
    settings.smtp = {
      host: body.host,
      port: body.port,
      username: body.username ?? "",
      from: body.from ?? body.username ?? "",
      secure: body.secure ?? body.port === 465,
    };
    if (body.slack_webhook !== undefined) settings.slack_webhook = body.slack_webhook || null;
    if (body.gchat_webhook !== undefined) settings.gchat_webhook = body.gchat_webhook || null;
    db.prepare("UPDATE app_extras SET settings_json = ? WHERE id='singleton'").run(
      JSON.stringify(settings)
    );
    db.prepare("UPDATE app_settings SET smtp_configured = 1 WHERE id='singleton'").run();
    return c.json({ ok: true });
  });

  gated.post("/smtp/test", async (c) => {
    const r = await sendTestEmail(vault);
    logNotification("smtp", "test_email", r.ok ? "sent" : "failed", r.detail);
    return c.json(r, r.ok ? 200 : 502);
  });

  gated.post("/thresholds", async (c) => {
    const body = await c.req.json<{
      name?: string;
      metric?: string;
      operator?: string;
      value?: number;
      channels?: string[];
      cooldown_minutes?: number;
    }>();
    if (!body.name || !body.metric || !body.operator || body.value === undefined)
      return c.json({ error: "name, metric, operator, value required" }, 400);
    getDb()
      .prepare(
        `INSERT INTO thresholds (id, name, metric, operator, value, channels_json, cooldown_minutes)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        newId(),
        body.name,
        body.metric,
        body.operator,
        body.value,
        JSON.stringify(body.channels ?? []),
        body.cooldown_minutes ?? 60
      );
    return c.json({ ok: true });
  });

  // Step 3: DigitalOcean auth (accepts full or partial updates so Settings
  // can rotate one credential without re-entering the other).
  gated.post("/do", async (c) => {
    const body = await c.req.json<{ do_token?: string; model_access_key?: string }>();
    const tok = body.do_token?.trim() ?? "";
    const key = body.model_access_key?.trim() ?? "";
    if (!tok && !key) return c.json({ error: "provide at least one credential" }, 400);
    if (tok) vault.set("do_token", tok);
    if (key) vault.set("model_access_key", key);
    if (vault.get("do_token") && vault.get("model_access_key"))
      getDb().prepare("UPDATE app_settings SET do_auth_configured = 1 WHERE id='singleton'").run();
    return c.json({ ok: true });
  });

  gated.post("/do/test", async (c) => {
    const doToken = vault.get("do_token");
    const modelKey = vault.get("model_access_key");
    if (!doToken || !modelKey)
      return c.json({ error: "save credentials before testing" }, 400);
    const client = new DOClient(doToken, modelKey);
    const [ctrl, inf] = await Promise.all([client.testControlPlane(), client.testInference()]);
    const ok = ctrl.ok && inf.ok;
    return c.json({ ok, control_plane: ctrl, inference: inf }, ok ? 200 : 502);
  });

  // Admin password rotation (post-onboarding; /admin stays first-boot-only).
  gated.post("/password", async (c) => {
    const m = (c.req.header("Cookie") ?? "").match(/sf_session=([^;]+)/);
    const adminId = sessionAdminId(m?.[1]);
    if (!adminId) return c.json({ error: "unauthenticated" }, 401);
    const body = await c.req.json<{ current_password?: string; new_password?: string }>();
    const admin = getDb().prepare("SELECT email FROM admins WHERE id=?").get(adminId) as {
      email: string;
    };
    if (!admin || !verifyAdmin(admin.email, body.current_password ?? ""))
      return c.json({ error: "current password is incorrect" }, 401);
    if ((body.new_password ?? "").length < 8)
      return c.json({ error: "new password must be ≥ 8 chars" }, 400);
    getDb()
      .prepare("UPDATE admins SET password_hash = ? WHERE id = ?")
      .run(hashPassword(body.new_password!), adminId);
    return c.json({ ok: true });
  });

  // Manual AI-credit remainder, copied from DO's billing page (no API exposes it).
  gated.get("/credit", (c) => {
    const s = getDb()
      .prepare("SELECT ai_credit_remaining, ai_credit_as_of FROM app_settings WHERE id='singleton'")
      .get() as { ai_credit_remaining: number | null; ai_credit_as_of: string | null };
    return c.json({ remaining: s?.ai_credit_remaining ?? null, as_of: s?.ai_credit_as_of ?? null });
  });

  gated.post("/credit", async (c) => {
    const body = await c.req.json<{ remaining?: number; as_of?: string }>();
    const remaining = Number(body.remaining);
    if (!Number.isFinite(remaining) || remaining < 0)
      return c.json({ error: "remaining must be a non-negative number" }, 400);
    const asOf = (body.as_of ?? "").trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return c.json({ error: "as_of must be YYYY-MM-DD" }, 400);
    getDb()
      .prepare("UPDATE app_settings SET ai_credit_remaining = ?, ai_credit_as_of = ? WHERE id='singleton'")
      .run(Math.round(remaining * 100) / 100, asOf);
    return c.json({ ok: true, remaining: Math.round(remaining * 100) / 100, as_of: asOf });
  });

  gated.post("/complete", (c) => {    const s = getDb().prepare("SELECT * FROM app_settings WHERE id='singleton'").get() as any;
    // Notifications are optional; admin + DigitalOcean credentials are required.
    if (!adminExists() || !s.do_auth_configured)
      return c.json({ error: "admin account and DigitalOcean credentials are required" }, 400);
    getDb().prepare("UPDATE app_settings SET setup_complete = 1 WHERE id='singleton'").run();
    return c.json({ ok: true });
  });

  app.route("/", gated);
  return app;
}
