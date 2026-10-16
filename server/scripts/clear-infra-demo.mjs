/** Remove SEED DEMO billing_daily rows. Usage: npx tsx scripts/clear-infra-demo.mjs */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb } from "../src/db/schema.js";

initDb(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const r = getDb().prepare("DELETE FROM billing_daily WHERE sku LIKE 'seed-demo-%'").run();
console.log("demo rows removed:", r.changes);
console.log("leftover:", getDb().prepare("SELECT COUNT(*) AS n FROM billing_daily WHERE sku LIKE 'seed-demo-%'").get());
