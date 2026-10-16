/**
 * Backfill telemetry_hourly (+ logs) from the REAL DigitalOcean billing-insights
 * lines stored in billing_state.breakdown_json (written by billing-sync).
 * Only AI token-usage lines are used; tax / credit / purchase lines are skipped.
 * Idempotent: aborts if backfill rows already exist for the insights dates.
 * Usage: node scripts/backfill-telemetry.mjs   (run from server/)
 */
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

const db = new DatabaseSync("./data/sailfish.db");
const row = db.prepare("SELECT breakdown_json FROM billing_state WHERE id='singleton'").get();
if (!row?.breakdown_json) {
  console.log("no breakdown_json stored; run a billing sync first");
  process.exit(1);
}
const points = JSON.parse(row.breakdown_json);

function modelFor(desc) {
  const d = (desc ?? "").toLowerCase();
  if (d.includes("v4.1") && d.includes("flash")) return "deepseek-v4.1-flash";
  if (d.includes("deepseek4 flash") || d.includes("deepseek-4")) return "deepseek-4-flash";
  if (d.includes("qwen3.8-max")) return "qwen3.8-max";
  if (d.includes("glm5.3 flash")) return "glm-5.3-flash";
  if (d.includes("glm 5.3")) return "glm-5.3";
  if (d.includes("gpt-oss-120b")) return "openai-gpt-oss-120b";
  return null;
}
function tokensOf(p) {
  const m = /\(([\d,]+)\s*@/.exec(p.description ?? "");
  const n = m ? parseInt(m[1].replace(/,/g, ""), 10) : 0;
  const d = (p.description ?? "").toLowerCase();
  if (d.includes("output")) return { pt: 0, ct: n };
  return { pt: n, ct: 0 }; // input + cache-read both count as prompt tokens
}

const usable = [];
for (const p of points) {
  const sku = (p.sku ?? "").toUpperCase();
  const amt = parseFloat(p.total_amount) || 0;
  if (!sku.startsWith("1-AI-")) continue; // skip tax/credit/purchase lines
  if (amt <= 0) continue;
  const model = modelFor(p.description);
  if (!model) {
    console.log("unmapped line skipped:", p.sku, "|", (p.description ?? "").slice(0, 70));
    continue;
  }
  usable.push({ ...p, model, amt, ...tokensOf(p) });
}
if (usable.length === 0) {
  console.log("no AI usage lines found");
  process.exit(0);
}

// idempotency: abort if hourly rows already exist for these (date, model) pairs
const dates = [...new Set(usable.map((u) => u.start_date))];
const models = [...new Set(usable.map((u) => u.model))];
const existing = db
  .prepare(
    `SELECT COUNT(*) AS n FROM telemetry_hourly WHERE substr(hour_ts,1,10) IN ('${dates.join("','")}') AND model_id IN ('${models.join("','")}')`
  )
  .get();
if (existing.n > 0) {
  console.log(`backfill already present (${existing.n} hourly rows for these dates/models); aborting`);
  process.exit(0);
}

const insertLog = db.prepare(
  "INSERT INTO telemetry_logs (id, timestamp, model_id, prompt_tokens, completion_tokens, total_cost_usd) VALUES (?,?,?,?,?,?)"
);
const upsertHour = db.prepare(
  `INSERT INTO telemetry_hourly (hour_ts, model_id, prompt_tokens, completion_tokens, cost_usd, requests)
   VALUES (?,?,?,?,?,1)
   ON CONFLICT(hour_ts, model_id) DO UPDATE SET
     prompt_tokens = prompt_tokens + excluded.prompt_tokens,
     completion_tokens = completion_tokens + excluded.completion_tokens,
     cost_usd = cost_usd + excluded.cost_usd,
     requests = requests + 1`
);
let logs = 0;
for (const u of usable) {
  const ts = `${u.start_date}T00:00:00.000Z`;
  insertLog.run(crypto.randomUUID(), ts, u.model, u.pt, u.ct, Math.round(u.amt * 1e6) / 1e6);
  upsertHour.run(ts, u.model, u.pt, u.ct, Math.round(u.amt * 1e6) / 1e6);
  logs++;
}
const total = usable.reduce((s, u) => s + u.amt, 0);
console.log(`backfilled ${logs} lines, $${total.toFixed(2)} across: ${models.join(", ")}`);
console.log(JSON.stringify(db.prepare("SELECT model_id, COUNT(*) AS n FROM telemetry_logs GROUP BY model_id").all()));
