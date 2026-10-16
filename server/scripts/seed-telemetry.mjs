/**
 * Inline seeding of telemetry_hourly + telemetry_logs with 7 days of
 * synthetic usage.  Bypasses the ingest HMAC by writing directly to SQLite
 * — safe for local dev only.
 *
 * Run: node scripts/seed-telemetry.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MASTER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(path.join(MASTER, "data", "sailfish.db"));

// Mirror of the server's pricing  (telemetry.ts)
const PRICES = {
  "llama-3.3-70b-instruct":  [0.9, 0.9],
  "llama-3.1-8b-instruct":   [0.1, 0.1],
  "mistral-large-latest":    [2.0, 6.0],
};
const FALLBACK = [0.5, 0.5];

function cost(prompt, completion, model) {
  const p = PRICES[model] ?? FALLBACK;
  return Math.round((prompt * p[0] + completion * p[1]) / 1_000_000 * 1e6) / 1e6;
}

const LOG = db.prepare(`INSERT INTO telemetry_logs (id, timestamp, model_id, prompt_tokens, completion_tokens, total_cost_usd) VALUES (?,?,?,?,?,?)`);
const HR = db.prepare(`INSERT INTO telemetry_hourly (hour_ts, model_id, prompt_tokens, completion_tokens, cost_usd, requests) VALUES (?,?,?,?,?,1) ON CONFLICT(hour_ts, model_id) DO UPDATE SET prompt_tokens = prompt_tokens + excluded.prompt_tokens, completion_tokens = completion_tokens + excluded.completion_tokens, cost_usd = cost_usd + excluded.cost_usd, requests = requests + 1`);

const MODELS = Object.keys(PRICES);
let n = 0;

for (let day = 6; day >= 0; day--) {
  for (const model of MODELS) {
    // 4 buckets per day
    for (let b = 0; b < 4; b++) {
      const p = 5000 + Math.floor(Math.random() * 45000);
      const c = 1000 + Math.floor(Math.random() * 8000);
      const ts = new Date(Date.now() - day * 86400000 - b * 6 * 3600000);
      const iso = ts.toISOString();
      const hour = iso.slice(0, 13) + ":00:00.000Z";

      LOG.run(randomUUID(), iso, model, p, c, cost(p, c, model));
      HR.run(hour, model, p, c, cost(p, c, model));
      n++;
    }
  }
}

console.log(`Seeded ${n} telemetry_log rows + aggregated into telemetry_hourly`);
