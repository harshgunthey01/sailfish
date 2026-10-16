/**
 * End-to-end test of the password-reset flow using a THROWAWAY admin.
 * Never touches the real admin account or its sessions.
 * Usage: npx tsx scripts/test-reset.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { initDb, getDb, newId } from "../src/db/schema.js";
import { createAdmin, hashPassword } from "../src/auth/admin.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
initDb(dataDir);
const db = getDb();
const BASE = "http://localhost:9000/api/v1/setup";
const EMAIL = "reset-test@example.com";

async function post(p, body) {
  const res = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// 0. forgot with unknown address -> still 200 (anti-enumeration)
console.log("forgot-unknown:", JSON.stringify(await post("/password/forgot", { email: "nobody@nowhere.test" })));

// 1. throwaway admin
db.prepare("DELETE FROM admins WHERE email = ?").run(EMAIL);
const adminId = createAdmin(EMAIL, "TempPass123!");
console.log("temp admin:", adminId.slice(0, 8));

// 2. forgot for throwaway -> 200 (email send will fail: smtp unconfigured, but token is stored first)
console.log("forgot-temp:", JSON.stringify(await post("/password/forgot", { email: EMAIL })));
const sesCount = (tok) =>
  db.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE admin_id = ?").get(adminId).n;
console.log("token rows for temp admin:", sesCount());

// grab the raw token is impossible by design; mint a KNOWN test token directly
const raw = "test-token-" + crypto.randomBytes(8).toString("hex");
const th = crypto.createHash("sha256").update(raw).digest("hex");
db.prepare(
  "INSERT INTO password_resets (id, admin_id, token_hash, expires_at) VALUES (?,?,?,datetime('now','+15 minutes'))"
).run(newId(), adminId, th);

// 3. reset validations
console.log("reset-garbage:", JSON.stringify(await post("/password/reset", { token: "nope", new_password: "NewPass123!" })));
console.log("reset-short:", JSON.stringify(await post("/password/reset", { token: raw, new_password: "short" })));

// 4. real reset
console.log("reset-ok:", JSON.stringify(await post("/password/reset", { token: raw, new_password: "NewPass123!" })));

// 5. single-use: reuse must fail
console.log("reset-reuse:", JSON.stringify(await post("/password/reset", { token: raw, new_password: "Other123!" })));

// 6. login with new password works, old does not
const login = async (pw) => {
  const res = await fetch(BASE + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: pw }),
  });
  return res.status;
};
console.log("login-new:", await login("NewPass123!"), "login-old:", await login("TempPass123!"));

// 7. expired token rejected
const raw2 = "expired-" + crypto.randomBytes(8).toString("hex");
db.prepare("INSERT INTO password_resets (id, admin_id, token_hash, expires_at) VALUES (?,?,?,datetime('now','-1 minute'))").run(
  newId(), adminId, crypto.createHash("sha256").update(raw2).digest("hex")
);
console.log("reset-expired:", JSON.stringify(await post("/password/reset", { token: raw2, new_password: "NewPass123!" })));

// 8. cleanup: temp admin, its sessions, its tokens. Real admin untouched.
db.prepare("DELETE FROM sessions WHERE admin_id = ?").run(adminId);
db.prepare("DELETE FROM password_resets WHERE admin_id = ?").run(adminId);
db.prepare("DELETE FROM admins WHERE id = ?").run(adminId);
console.log("remaining admins:", JSON.stringify(db.prepare("SELECT email FROM admins").all()));
console.log("leftover reset rows:", db.prepare("SELECT COUNT(*) AS n FROM password_resets").get().n);
console.log("DONE");
