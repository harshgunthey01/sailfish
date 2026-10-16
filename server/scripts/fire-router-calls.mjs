/**
 * Fire minimal inference requests THROUGH the live DO router and record the
 * REAL returned token usage into local telemetry.
 * Only non-secret summaries are printed (no keys).
 * Usage: npx tsx scripts/fire-router-calls.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { Vault } from "../src/services/vault.js";

const vault = new Vault(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const modelKey = vault.get("model_access_key");
if (!modelKey) {
  console.log("no model_access_key in vault");
  process.exit(1);
}
const ingestToken = crypto.createHmac("sha256", "sailfish-ingest-v1").update(modelKey).digest("hex");

const ROUTER_MODEL = "router:do-code-creator"; // routers are addressed with the "router:" prefix (see list-models.mjs)
const prompts = ["Reply with exactly: pong1", "Reply with exactly: pong2", "Reply with exactly: pong3"];

for (let i = 0; i < prompts.length; i++) {
  const res = await fetch("https://inference.do-ai.run/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${modelKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ROUTER_MODEL,
      messages: [{ role: "user", content: prompts[i] }],
      max_tokens: 10,
      temperature: 0,
    }),
  });
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    console.log(`call ${i + 1}: status=${res.status} non-json: ${text.slice(0, 200)}`);
    continue;
  }
  if (!res.ok) {
    console.log(`call ${i + 1}: status=${res.status} error=${JSON.stringify(j).slice(0, 300)}`);
    continue;
  }
  const usedModel = j.model ?? ROUTER_MODEL;
  const pt = j.usage?.prompt_tokens ?? 0;
  const ct = j.usage?.completion_tokens ?? 0;
  const reply = (j.choices?.[0]?.message?.content ?? "").trim().slice(0, 60);

  const ing = await fetch("http://localhost:9000/api/v1/telemetry/ingest", {
    method: "POST",
    headers: { Authorization: `Bearer ${ingestToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: usedModel, prompt_tokens: pt, completion_tokens: ct }),
  });
  console.log(
    `call ${i + 1}: inference=200 routed_to=${usedModel} prompt_tokens=${pt} completion_tokens=${ct} reply=${JSON.stringify(reply)} ingest=${ing.status}`
  );
}
console.log("done");
