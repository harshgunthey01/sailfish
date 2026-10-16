/** Read-only: full inference model list, check whether router names appear. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../src/services/vault.js";

const vault = new Vault(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const modelKey = vault.get("model_access_key");
const r = await fetch("https://inference.do-ai.run/v1/models", {
  headers: { Authorization: `Bearer ${modelKey}` },
});
const j = await r.json();
const ids = (j.data ?? j.models ?? []).map((m) => m.id ?? m.name ?? m);
console.log("total:", ids.length);
console.log("tail:", ids.slice(60).join(", "));
console.log("has do-code-creator:", ids.includes("do-code-creator"));
console.log("has inference-router:", ids.includes("inference-router"));
