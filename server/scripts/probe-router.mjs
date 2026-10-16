/**
 * Read-only reproduce: GET the phantom inference-router by UUID.
 * Usage: npx tsx scripts/probe-router.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../src/services/vault.js";

const vault = new Vault(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const token = vault.get("do_token");
const uuid = "11f1c36a-5ebf-0a46-aee4-4e013e2ddde4"; // inference-router

for (const [method, p] of [
  ["GET", `/v2/gen-ai/models/routers/${uuid}`],
]) {
  const res = await fetch("https://api.digitalocean.com" + p, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  console.log(method, p, "->", res.status);
  console.log(text.slice(0, 600));
}
