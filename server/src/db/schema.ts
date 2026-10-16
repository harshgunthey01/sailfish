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
    total_cost_usd REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_telemetry_model ON telemetry_logs(model_id);

  CREATE TABLE IF NOT EXISTS billing_state (
    id TEXT PRIMARY KEY,
    compute_balance REAL NOT NULL DEFAULT 0,
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
    do_auth_configured INTEGER NOT NULL DEFAULT 0
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
    inference_balance REAL NOT NULL,
    spend_limit REAL
  );
  CREATE INDEX IF NOT EXISTS idx_billing_history_ts ON billing_history(ts);

  CREATE TABLE IF NOT EXISTS telemetry_hourly (
    hour_ts TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS thresholds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('compute_balance','inference_balance','inference_remaining_pct')),
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
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
