/** One-off: delete demo-seed telemetry rows, keep real ones. */
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./data/sailfish.db");
const DEMO = ["llama-3.1-8b-instruct", "llama-3.3-70b-instruct", "mistral-large-latest"];
const q = `DELETE FROM telemetry_logs WHERE model_id IN ('${DEMO.join("','")}')`;
console.log("demo log rows deleted:", db.prepare(q).run().changes);
console.log(
  "demo hourly rows deleted:",
  db.prepare(`DELETE FROM telemetry_hourly WHERE model_id IN ('${DEMO.join("','")}')`).run().changes
);
console.log(
  "remaining:",
  JSON.stringify(db.prepare("SELECT model_id, COUNT(*) AS n FROM telemetry_logs GROUP BY model_id").all())
);
