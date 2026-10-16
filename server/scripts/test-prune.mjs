import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb } from "../src/db/schema.js";
import { pruneTelemetry } from "../src/services/telemetry.js";

initDb(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const db = getDb();
const before = db.prepare(
  "SELECT (SELECT COUNT(*) FROM telemetry_logs) AS logs, (SELECT COUNT(*) FROM telemetry_hourly) AS hourly, (SELECT COUNT(*) FROM billing_history) AS hist, (SELECT COUNT(*) FROM sessions) AS sess"
).get();
pruneTelemetry();
const after = db.prepare(
  "SELECT (SELECT COUNT(*) FROM telemetry_logs) AS logs, (SELECT COUNT(*) FROM telemetry_hourly) AS hourly, (SELECT COUNT(*) FROM billing_history) AS hist, (SELECT COUNT(*) FROM sessions) AS sess"
).get();
console.log("before:", JSON.stringify(before));
console.log("after:", JSON.stringify(after));
console.log("DONE");
