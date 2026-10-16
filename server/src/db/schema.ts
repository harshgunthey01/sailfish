import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

let db: DatabaseSync | null = null;

export function initDb(dataDir: string): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "sailfish.db");
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error("db not initialized");
  return db;
}

function migrate(d: DatabaseSync) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ===== PRD §4.1 collections (1:1) =====
  CREATE TABLE IF NOT EXISTS telemetry_logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    router TEXT,
    task TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_telemetry_model ON telemetry_logs(model_id);

  CREATE TABLE IF NOT EXISTS billing_state (
    id TEXT PRIMARY KEY,
    compute_balance REAL NOT NULL DEFAULT 0,
    core_compute_mtd REAL NOT NULL DEFAULT 0,
    ai_usage_mtd REAL NOT NULL DEFAULT 0,
    tax_mtd REAL NOT NULL DEFAULT 0,
    account_balance REAL NOT NULL DEFAULT 0,
    prepaid_amount REAL NOT NULL DEFAULT 0,
    payments_json TEXT,
    breakdown_json TEXT,
    inference_balance REAL NOT NULL DEFAULT 0,
    is_blocked INTEGER NOT NULL DEFAULT 0,
    last_synced TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS router_rules (
    id TEXT PRIMARY KEY,
    rule_name TEXT NOT NULL,
    target_model TEXT NOT NULL,
    priority_metric TEXT NOT NULL DEFAULT 'Cost' CHECK (priority_metric IN ('Cost','Latency')),
    is_active INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    cost_weight INTEGER NOT NULL DEFAULT 50
  );

  CREATE TABLE IF NOT EXISTS managed_models (
    id TEXT PRIMARY KEY,
    model_name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Deploying','Removed'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY,
    setup_complete INTEGER NOT NULL DEFAULT 0,
    smtp_configured INTEGER NOT NULL DEFAULT 0,
    do_auth_configured INTEGER NOT NULL DEFAULT 0,
    ai_credit_remaining REAL,
    ai_credit_as_of TEXT
  );

  -- ===== extensions (see ARCHITECTURE.md §7) =====
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS billing_history (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    compute_balance REAL NOT NULL,
    core_compute_mtd REAL NOT NULL DEFAULT 0,
    ai_usage_mtd REAL NOT NULL DEFAULT 0,
    inference_balance REAL NOT NULL,
    spend_limit REAL
  );
  CREATE INDEX IF NOT EXISTS idx_billing_history_ts ON billing_history(ts);

  -- per-day per-SKU billing lines (Phase-1 spend history; ~50 rows/day)
  CREATE TABLE IF NOT EXISTS billing_daily (
    day TEXT NOT NULL,
    sku TEXT NOT NULL,
    model_key TEXT NOT NULL,
    description TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    amount_usd REAL NOT NULL,
    PRIMARY KEY (day, sku, description)
  );
  CREATE INDEX IF NOT EXISTS idx_billing_daily_day ON billing_daily(day);

  CREATE TABLE IF NOT EXISTS telemetry_hourly (
    hour_ts TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0,
    -- router/task detail lives in telemetry_logs; hourly stays model-grain
    -- (per-router rollups are computed from logs; see MONITORING.md §D).
    router TEXT NOT NULL DEFAULT '',
    task TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (hour_ts, model_id)
  );

  CREATE TABLE IF NOT EXISTS router_snapshots (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    label TEXT NOT NULL,
    rules_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
    payload_json TEXT NOT NULL DEFAULT '{}',
    stdout TEXT,
    stderr TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notification_log (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    channel TEXT NOT NULL,
    event TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT
  );

  -- single-use password-reset tokens (proves inbox access)
  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_hash ON password_resets(token_hash);

  -- live observed $/1M rates from insights "@ $P/thousand" annotations
  CREATE TABLE IF NOT EXISTS model_rates (
    model_key TEXT PRIMARY KEY,
    input_per_1m REAL NOT NULL,
    output_per_1m REAL NOT NULL,
    cache_per_1m REAL,
    observed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS thresholds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('compute_balance','inference_balance','inference_remaining_pct','daily_spend_usd','daily_spend_spike')),
    operator TEXT NOT NULL CHECK (operator IN ('gt','lt')),
    value REAL NOT NULL,
    channels_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_triggered_at TEXT,
    cooldown_minutes INTEGER NOT NULL DEFAULT 60
  );

  CREATE TABLE IF NOT EXISTS app_extras (
    id TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL DEFAULT '{}'
  );
  INSERT OR IGNORE INTO app_extras (id, settings_json) VALUES ('singleton', '{}');

  INSERT OR IGNORE INTO app_settings (id, setup_complete, smtp_configured, do_auth_configured)
  VALUES ('singleton', 0, 0, 0);
  INSERT OR IGNORE INTO billing_state (id, compute_balance, inference_balance, is_blocked, last_synced)
  VALUES ('singleton', 0, 0, 0, datetime('now'));
  `);

  // ---- incremental migrations (bring older DBs up to date) ----
  addColumnIfMissing(d, "billing_state", "core_compute_mtd", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(d, "billing_state", "ai_usage_mtd", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(d, "billing_state", "tax_mtd", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(d, "billing_state", "account_balance", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(d, "billing_state", "prepaid_amount", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(d, "billing_state", "payments_json", "TEXT");
  addColumnIfMissing(d, "billing_state", "breakdown_json", "TEXT");
  addColumnIfMissing(d, "billing_history", "core_compute_mtd", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(d, "billing_history", "ai_usage_mtd", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(d, "telemetry_logs", "router", "TEXT");
  addColumnIfMissing(d, "telemetry_logs", "task", "TEXT");
  addColumnIfMissing(d, "telemetry_hourly", "router", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "telemetry_hourly", "task", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "app_settings", "ai_credit_remaining", "REAL");
  addColumnIfMissing(d, "app_settings", "ai_credit_as_of", "TEXT");
  addColumnIfMissing(d, "model_rates", "cache_per_1m", "REAL");

  // SQLite cannot ALTER a CHECK constraint: rebuild thresholds once to widen
  // the metric set for Phase-2 spike metrics. Existing rows are preserved.
  const tSql = (d.prepare("SELECT sql FROM sqlite_master WHERE name='thresholds'").get() as any)?.sql ?? "";
  if (!tSql.includes("daily_spend_spike")) {
    d.exec(`
    CREATE TABLE thresholds_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      metric TEXT NOT NULL CHECK (metric IN ('compute_balance','inference_balance','inference_remaining_pct','daily_spend_usd','daily_spend_spike')),
      operator TEXT NOT NULL CHECK (operator IN ('gt','lt')),
      value REAL NOT NULL,
      channels_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_triggered_at TEXT,
      cooldown_minutes INTEGER NOT NULL DEFAULT 60
    );
    INSERT INTO thresholds_new (id, name, metric, operator, value, channels_json, is_active, last_triggered_at, cooldown_minutes)
      SELECT id, name, metric, operator, value, channels_json, is_active, last_triggered_at, cooldown_minutes FROM thresholds;
    DROP TABLE thresholds;
    ALTER TABLE thresholds_new RENAME TO thresholds;
    `);
  }
}

function addColumnIfMissing(d: DatabaseSync, table: string, column: string, def: string) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
