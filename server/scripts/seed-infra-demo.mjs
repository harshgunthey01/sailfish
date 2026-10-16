/**
 * Seed DEMO core-spend rows for visual verification of the Infrastructure page.
 * All rows use sku 'seed-demo-*' so cleanup is one DELETE (see clear-infra-demo.mjs).
 * Droplet/database tables themselves stay live (API-sourced, unfakeable).
 * Usage: npx tsx scripts/seed-infra-demo.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb } from "../src/db/schema.js";
import { coreAttribution } from "../src/services/billing-sync.js";

initDb(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const db = getDb();
const today = new Date().toISOString().slice(0, 10);
const rows = [
  ["seed-demo-core-1", "SEED DEMO — droplet compute", "lon1", 12.4],
  ["seed-demo-core-2", "SEED DEMO — droplet compute", "blr1", 3.1],
  ["seed-demo-core-3", "SEED DEMO — unattributed", "", 1.5],
];
for (const [sku, desc, region, amt] of rows) {
  db.prepare(
    `INSERT INTO billing_daily (day, sku, model_key, description, region, amount_usd)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(day, sku, description) DO UPDATE SET amount_usd = excluded.amount_usd, region = excluded.region`
  ).run(today, sku, "core", desc, region, amt);
}
console.log("seeded demo core rows for", today);
console.log("attribution preview:", JSON.stringify(coreAttribution([])));
console.log("NOTE: the Core Compute tile still shows live $0.00 — seeded rows only feed the regions table.");
console.log("Clean up with: npx tsx scripts/clear-infra-demo.mjs");
