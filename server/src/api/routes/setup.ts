import { Hono } from "hono";
import { getDb, newId } from "../../db/schema.js";
import {
  adminExists,
  createAdmin,
  createSession,
  verifyAdmin,
  sessionAdminId,
  destroySession,
  hashPassword,
} from "../../auth/admin.js";
import { sendTestEmail, logNotification } from "../../services/notifier.js";
import type { Vault } from "../../services/vault.js";
import { DOClient } from "../../do/client.js";

export function setupRoutes(vault: Vault): Hono {
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

  app.get("/me", (c) => {
    const m = (c.req.header("Cookie") ?? "").match(/sf_session=([^;]+)/);
    const adminId = sessionAdminId(m?.[1]);
    if (!adminId) return c.json({ authenticated: false });
    const admin = getDb().prepare("SELECT email FROM admins WHERE id=?").get(adminId) as {
      email: string;
    };
    return c.json({ authenticated: true, email: admin.email });
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
