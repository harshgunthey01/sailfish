/**
 * Read-only: list valid inference model IDs + full router detail.
 * Usage: npx tsx scripts/check-router-invoke.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../src/services/vault.js";

const vault = new Vault(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const modelKey = vault.get("model_access_key");
const doToken = vault.get("do_token");

const ml = await fetch("https://inference.do-ai.run/v1/models", {
  headers: { Authorization: `Bearer ${modelKey}` },
});
const mj = await ml.json().catch(() => null);
console.log("models status:", ml.status);
const ids = (mj?.data ?? mj?.models ?? []).map((m) => m.id ?? m.name ?? m);
console.log("model count:", ids.length);
console.log(ids.slice(0, 60).join(", "));

const rl = await fetch("https://api.digitalocean.com/v2/gen-ai/models/routers?per_page=200", {
  headers: { Authorization: `Bearer ${doToken}` },
});
const rj = await rl.json();
const target = (rj.model_routers ?? []).find((r) => r.name === "do-code-creator");
console.log("== do-code-creator full ==");
console.log(JSON.stringify(target, null, 2).slice(0, 2500));
