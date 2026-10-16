/**
 * Read-only probe: find where DO reports REMAINING AI/credit balance.
 * Prints status + body for each candidate endpoint. No secrets printed.
 * Usage: npx tsx scripts/probe-credit.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../src/services/vault.js";

const vault = new Vault(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const token = vault.get("do_token");
if (!token) {
  console.log("no do_token");
  process.exit(1);
}

async function get(p) {
  const res = await fetch("https://api.digitalocean.com" + p, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  return { path: p, status: res.status, body: text.slice(0, 1200) };
}

const paths = [
  "/v2/customers/my/balance",
  "/v2/customers/my/prepayment_config",
  "/v2/customers/my/prepayment_status",
  "/v2/customers/my/credits",
  "/v2/customers/my/billing_history?per_page=5",
];
for (const p of paths) {
  try {
    const r = await get(p);
    console.log("==", r.path, "->", r.status);
    console.log(r.body);
    console.log("");
  } catch (e) {
    console.log("==", p, "ERROR", e.message);
  }
}
