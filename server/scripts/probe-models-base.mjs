/** Read-only: does GET https://api.digitalocean.com/v1/models work with the model key? */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../src/services/vault.js";

const vault = new Vault(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const modelKey = vault.get("model_access_key");
for (const base of ["https://api.digitalocean.com", "https://inference.do-ai.run"]) {
  const res = await fetch(base + "/v1/models", {
    headers: { Authorization: `Bearer ${modelKey}` },
  });
  const text = await res.text();
  console.log(base, "->", res.status, text.slice(0, 200));
}
