/** Verify ingest accepts router/task (Phase 1-D). Usage: npx tsx scripts/test-ingest.mjs */
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { Vault } from "../src/services/vault.js";
import { initDb, getDb } from "../src/db/schema.js";

const root = path.dirname(fileURLToPath(import.meta.url));
initDb(path.join(root, "..", "data"));
const vault = new Vault(path.join(root, "..", "data"));
const token = crypto.createHmac("sha256", "sailfish-ingest-v1").update(vault.get("model_access_key")).digest("hex");

const res = await fetch("http://localhost:9000/api/v1/telemetry/ingest", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model_id: "ingest-test-model",
    prompt_tokens: 10,
    completion_tokens: 5,
    router: "router:do-code-creator",
    task: "smoke-test",
  }),
});
console.log("ingest:", res.status, JSON.stringify(await res.json()));
const row = getDb()
  .prepare("SELECT model_id, router, task FROM telemetry_logs WHERE model_id='ingest-test-model' ORDER BY timestamp DESC LIMIT 1")
  .get();
console.log("stored:", JSON.stringify(row));
getDb().prepare("DELETE FROM telemetry_logs WHERE model_id='ingest-test-model'").run();
getDb().prepare("DELETE FROM telemetry_hourly WHERE model_id='ingest-test-model'").run();
console.log("test row cleaned up");
