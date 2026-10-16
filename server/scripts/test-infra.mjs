/**
 * Test core attribution with synthetic rows (full cleanup after).
 * Usage: npx tsx scripts/test-infra.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb } from "../src/db/schema.js";
import { coreAttribution } from "../src/services/billing-sync.js";

initDb(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const db = getDb();
db.prepare(
  `INSERT INTO billing_daily (day, sku, model_key, description, region, amount_usd)
   VALUES (date('now'), 'test-infra-1', 'core', 'test droplet line', 'blr1', 5.0),
          (date('now'), 'test-infra-2', 'core', 'test other region', 'nyc3', 3.0)`
).run();

const single = coreAttribution([{ name: "web-1", region: "blr1" }]);
console.log("single-droplet region:", JSON.stringify(single));
const multi = coreAttribution([
  { name: "web-1", region: "blr1" },
  { name: "db-1", region: "blr1" },
]);
console.log("multi-droplet region:", JSON.stringify(multi));
const none = coreAttribution([]);
console.log("no droplets:", JSON.stringify(none));

db.prepare("DELETE FROM billing_daily WHERE sku LIKE 'test-infra-%'").run();
console.log("leftover:", db.prepare("SELECT COUNT(*) AS n FROM billing_daily WHERE sku LIKE 'test-infra-%'").get());
console.log("DONE");
