/**
 * List live DO model routers (read-only).
 * Usage: npx tsx scripts/list-routers.mjs
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

const res = await fetch("https://api.digitalocean.com/v2/gen-ai/models/routers?per_page=200", {
  headers: { Authorization: `Bearer ${token}` },
});
console.log("status:", res.status);
const j = await res.json();
for (const r of j.model_routers ?? []) {
  console.log("---");
  console.log("name:", r.name, "| uuid:", r.uuid, "| regions:", JSON.stringify(r.regions));
  console.log("fallback_models:", JSON.stringify(r.config?.fallback_models));
  for (const p of r.config?.policies ?? []) {
    console.log("policy:", p.task_slug, "->", JSON.stringify(p.models), "| prefer:", p.selection_policy?.prefer ?? p.prefer ?? "?");
  }
}
