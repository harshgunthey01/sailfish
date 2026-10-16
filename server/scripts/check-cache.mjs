import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./data/sailfish.db");
// hand recomputation, independent of cacheSummary()
const rows = db.prepare(
  `SELECT model_key,
    SUM(CASE WHEN LOWER(description) LIKE '%cache%read%' THEN prompt_tokens ELSE 0 END) AS cache_tokens,
    SUM(CASE WHEN LOWER(description) NOT LIKE '%cache%' THEN prompt_tokens ELSE 0 END) AS input_tokens
   FROM billing_daily WHERE day >= date('now','-30 days')
   AND model_key NOT IN ('tax','credit','ai_credit_purchase') GROUP BY model_key`
).all();
let tc = 0, ti = 0;
for (const r of rows) {
  const denom = r.cache_tokens + r.input_tokens;
  const rate = db.prepare("SELECT input_per_1m, cache_per_1m FROM model_rates WHERE model_key = ?").get(r.model_key);
  const sav = rate?.cache_per_1m != null ? (r.cache_tokens * (rate.input_per_1m - rate.cache_per_1m)) / 1e6 : null;
  console.log(r.model_key, "hit=" + (denom ? (r.cache_tokens / denom).toFixed(4) : "null"),
    "saved=" + (sav != null ? sav.toFixed(4) : "unknown"));
  tc += r.cache_tokens; ti += r.input_tokens;
}
console.log("overall hit=" + (tc / (tc + ti)).toFixed(4), "cache_tokens=" + tc);
