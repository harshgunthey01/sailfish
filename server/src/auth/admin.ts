import crypto from "node:crypto";
import { getDb, newId, nowIso } from "../db/schema.js";

/**
 * Minimal admin auth: scrypt password hashing, httpOnly session cookies.
 */

const SESSION_DAYS = 7;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltHex, hashHex] = stored.split(":");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createAdmin(email: string, password: string): string {
  const db = getDb();
  const id = newId();
  db.prepare("INSERT INTO admins (id, email, password_hash) VALUES (?, ?, ?)").run(
    id,
    email.toLowerCase(),
    hashPassword(password)
  );
  return id;
}

export function adminExists(): boolean {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM admins").get() as { n: number };
  return row.n > 0;
}

export function verifyAdmin(email: string, password: string): string | null {
  const row = getDb()
    .prepare("SELECT id, password_hash FROM admins WHERE email = ?")
    .get(email.toLowerCase()) as { id: string; password_hash: string } | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return row.id;
}

export function createSession(adminId: string): { token: string; cookie: string } {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare("INSERT INTO sessions (id, admin_id, token_hash, expires_at) VALUES (?, ?, ?, ?)").run(
    newId(),
    adminId,
    tokenHash,
    expires
  );
  return {
    token,
    cookie: `sf_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`,
  };
}

export function sessionAdminId(token: string | undefined): string | null {
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const row = getDb()
    .prepare(
      "SELECT admin_id, expires_at FROM sessions WHERE token_hash = ?"
    )
    .get(tokenHash) as { admin_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.admin_id;
}

export function destroySession(token: string) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

/** Log out everywhere (used after a password reset so stolen sessions die). */
export function destroySessionsForAdmin(adminId: string) {
  getDb().prepare("DELETE FROM sessions WHERE admin_id = ?").run(adminId);
}

/** HMAC key for telemetry ingest, derived from model access key. */
export function ingestToken(modelAccessKey: string): string {
  return crypto.createHmac("sha256", "sailfish-ingest-v1").update(modelAccessKey).digest("hex");
}

export function verifyIngestToken(modelAccessKey: string, provided: string): boolean {
  const expected = ingestToken(modelAccessKey);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

export function utcNow(): string {
  return nowIso();
}
