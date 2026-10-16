import nodemailer from "nodemailer";
import { getDb, newId } from "../db/schema.js";
import type { Vault } from "./vault.js";

export interface SmtpSettings {
  host: string;
  port: number;
  username: string;
  from: string;
  secure: boolean;
}

export interface NotificationSettings {
  smtp: SmtpSettings | null;
  slack_webhook: string | null;
  gchat_webhook: string | null;
}

export function loadNotificationSettings(): NotificationSettings {
  const row = getDb()
    .prepare("SELECT settings_json FROM app_extras WHERE id='singleton'")
    .get() as { settings_json: string } | undefined;
  if (!row) return { smtp: null, slack_webhook: null, gchat_webhook: null };
  try {
    const j = JSON.parse(row.settings_json);
    return {
      smtp: j.smtp ?? null,
      slack_webhook: j.slack_webhook ?? null,
      gchat_webhook: j.gchat_webhook ?? null,
    };
  } catch {
    return { smtp: null, slack_webhook: null, gchat_webhook: null };
  }
}

export async function sendChannel(
  channel: "smtp" | "slack" | "gchat",
  msg: string,
  vault: Vault
): Promise<{ ok: boolean; detail: string }> {
  const settings = loadNotificationSettings();
  try {
    switch (channel) {
      case "smtp": {
        if (!settings.smtp) return { ok: false, detail: "smtp not configured" };
        const pw = vault.get("smtp_password") ?? "";
        const t = nodemailer.createTransport({
          host: settings.smtp.host,
          port: settings.smtp.port,
          secure: settings.smtp.secure,
          auth: settings.smtp.username ? { user: settings.smtp.username, pass: pw } : undefined,
        });
        await t.sendMail({
          from: settings.smtp.from,
          to: settings.smtp.from,
          subject: "Sailfish alert",
          text: msg,
        });
        return { ok: true, detail: "sent" };
      }
      case "slack": {
        if (!settings.slack_webhook) return { ok: false, detail: "slack webhook not configured" };
        const res = await fetch(settings.slack_webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: msg }),
          signal: AbortSignal.timeout(8000),
        });
        return res.ok
          ? { ok: true, detail: `slack ${res.status}` }
          : { ok: false, detail: `slack ${res.status}` };
      }
      case "gchat": {
        if (!settings.gchat_webhook) return { ok: false, detail: "gchat webhook not configured" };
        const res = await fetch(settings.gchat_webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: msg }),
          signal: AbortSignal.timeout(8000),
        });
        return res.ok
          ? { ok: true, detail: `gchat ${res.status}` }
          : { ok: false, detail: `gchat ${res.status}` };
      }
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendTestEmail(vault: Vault): Promise<{ ok: boolean; detail: string }> {
  return sendChannel("smtp", "Sailfish test email — SMTP configuration works.", vault);
}

export function logNotification(channel: string, event: string, status: string, detail: string) {
  getDb()
    .prepare("INSERT INTO notification_log (id, channel, event, status, detail) VALUES (?,?,?,?,?)")
    .run(newId(), channel, event, status, detail);
}
