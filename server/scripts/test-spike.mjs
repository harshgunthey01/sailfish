/**
 * Test spike-threshold evaluation end-to-end, then clean up fully.
 * Usage: npx tsx scripts/test-spike.mjs
 */
import { initDb, getDb, newId } from "../src/db/schema.js";
import { dailySpike } from "../src/services/billing-sync.js";
import { evaluateThresholds, resetBlocked } from "../src/services/thresholds.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

initDb(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const db = getDb();

// fake 7-day $1 baseline (model bucket) + a fake TODAY $5 spike
for (let i = 1; i <= 7; i++) {
  db.prepare(
    `INSERT INTO billing_daily (day, sku, model_key, description, amount_usd)
     VALUES (date('now', ?), 'test-sku', 'qwen3.8-max', 'spike test', 1.0)
     ON CONFLICT(day, sku, description) DO NOTHING`
  ).run(`-${i} days`);
}
db.prepare(
  `INSERT INTO billing_daily (day, sku, model_key, description, amount_usd)
   VALUES (date('now'), 'test-sku-today', 'qwen3.8-max', 'spike test today', 5.0)
   ON CONFLICT(day, sku, description) DO NOTHING`
).run();
const spike = dailySpike(db);
console.log("spike ctx:", JSON.stringify(spike));

const tid = newId();
db.prepare(
  `INSERT INTO thresholds (id, name, metric, operator, value, channels_json, cooldown_minutes)
   VALUES (?, 'spike-test', 'daily_spend_spike', 'gt', 2.0, '[]', 60)`
).run(tid);
const tid2 = newId();
db.prepare(
  `INSERT INTO thresholds (id, name, metric, operator, value, channels_json, cooldown_minutes)
   VALUES (?, 'usd-test', 'daily_spend_usd', 'gt', 0.01, '[]', 60)`
).run(tid2);

const breaches = evaluateThresholds({
  compute_balance: 0,
  inference_balance: 0,
  spend_limit: null,
  daily_spend_usd: spike.today,
  daily_spend_spike: spike.ratio,
});
console.log("breaches:", JSON.stringify(breaches));
console.log("is_blocked:", db.prepare("SELECT is_blocked FROM billing_state WHERE id='singleton'").get());

// cooldown: second run must be silent
const again = evaluateThresholds({
  compute_balance: 0,
  inference_balance: 0,
  spend_limit: null,
  daily_spend_usd: spike.today,
  daily_spend_spike: spike.ratio,
});
console.log("second run (cooldown):", JSON.stringify(again));

// cleanup everything
db.prepare("DELETE FROM thresholds WHERE id IN (?, ?)").run(tid, tid2);
db.prepare("DELETE FROM billing_daily WHERE sku IN ('test-sku', 'test-sku-today')").run();
resetBlocked();
console.log("is_blocked after reset:", db.prepare("SELECT is_blocked FROM billing_state WHERE id='singleton'").get());
console.log("thresholds left:", db.prepare("SELECT COUNT(*) AS n FROM thresholds").get());
console.log("DONE");
