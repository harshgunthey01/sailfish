import { getDb, newId, nowIso } from "../db/schema.js";

/**
 * Telemetry ingest + rollups (ARCHITECTURE §6.3).
 * Clients POST usage objects; server prices them from a bundled table and
 * maintains hourly rollups so 7-day charts stay cheap on a tiny VM.
 */

interface PriceRow {
  input: number; // USD per 1M tokens
  output: number;
}

// Curated defaults (USD per 1M tokens); overridable later via UI.
export const PRICING: Record<string, PriceRow> = {
  "llama-3.3-70b-instruct": { input: 0.9, output: 0.9 },
  "llama3.3-70b-instruct": { input: 0.9, output: 0.9 },
  "llama-3.1-8b-instruct": { input: 0.1, output: 0.1 },
  "llama3.1-8b-instruct": { input: 0.1, output: 0.1 },
  "llama-3.2-3b-instruct": { input: 0.05, output: 0.05 },
  "qwen3-32b": { input: 0.5, output: 0.5 },
  "qwen3-235b-a22b": { input: 1.0, output: 1.0 },
  "openai-gpt-oss-120b": { input: 0.4, output: 0.4 },
  "openai-gpt-oss-20b": { input: 0.1, output: 0.1 },
  "mistral-large-latest": { input: 2.0, output: 6.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "deepseek-v3.2": { input: 0.6, output: 1.7 },
};

export const FALLBACK_PRICE: PriceRow = { input: 0.5, output: 0.5 };

export function priceFor(modelId: string): PriceRow {
  return PRICING[modelId.toLowerCase()] ?? FALLBACK_PRICE;
}

export function costUsd(modelId: string, promptTokens: number, completionTokens: number): number {
  const p = priceFor(modelId);
  return round6((promptTokens * p.input + completionTokens * p.output) / 1_000_000);
}

export function ingestTelemetry(e: {
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  ts?: string;
}): { id: string; total_cost_usd: number } {
  const db = getDb();
  const ts = e.ts ?? nowIso();
  const cost = costUsd(e.model_id, e.prompt_tokens, e.completion_tokens);
  const id = newId();

  db.prepare(
    `INSERT INTO telemetry_logs (id, timestamp, model_id, prompt_tokens, completion_tokens, total_cost_usd)
     VALUES (?,?,?,?,?,?)`
  ).run(id, ts, e.model_id, e.prompt_tokens, e.completion_tokens, cost);

  const hour = ts.slice(0, 13) + ":00:00.000Z";
  db.prepare(
    `INSERT INTO telemetry_hourly (hour_ts, model_id, prompt_tokens, completion_tokens, cost_usd, requests)
     VALUES (?,?,?,?,?,1)
     ON CONFLICT(hour_ts, model_id) DO UPDATE SET
       prompt_tokens = prompt_tokens + excluded.prompt_tokens,
       completion_tokens = completion_tokens + excluded.completion_tokens,
       cost_usd = cost_usd + excluded.cost_usd,
       requests = requests + 1`
  ).run(hour, e.model_id, e.prompt_tokens, e.completion_tokens, cost);

  return { id, total_cost_usd: cost };
}

export interface SeriesQuery {
  days?: number;
  model?: string;
}

export function burnRateSeries(q: SeriesQuery) {
  const db = getDb();
  const days = Math.min(Math.max(q.days ?? 7, 1), 90);
  const rows = db
    .prepare(
      `SELECT hour_ts, model_id, prompt_tokens, completion_tokens, cost_usd, requests
       FROM telemetry_hourly
       WHERE hour_ts >= datetime('now', ?)
       ORDER BY hour_ts ASC`
    )
    .all(`-${days} days`) as Array<{
    hour_ts: string;
    model_id: string;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    requests: number;
  }>;
  return q.model ? rows.filter((r) => r.model_id === q.model) : rows;
}

export function costByModel(days = 7) {
  const db = getDb();
  return db
    .prepare(
      `SELECT model_id, SUM(cost_usd) AS cost, SUM(requests) AS requests,
              SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens
       FROM telemetry_hourly
       WHERE hour_ts >= datetime('now', ?)
       GROUP BY model_id ORDER BY cost DESC`
    )
    .all(`-${days} days`);
}

export function pruneTelemetry() {
  const db = getDb();
  db.prepare(`DELETE FROM telemetry_logs WHERE timestamp < datetime('now', '-30 days')`).run();
  db.prepare(`DELETE FROM telemetry_hourly WHERE hour_ts < datetime('now', '-365 days')`).run();
  db.prepare(`DELETE FROM notification_log WHERE ts < datetime('now', '-90 days')`).run();
  db.prepare(`DELETE FROM jobs WHERE created_at < datetime('now', '-30 days')`).run();
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
