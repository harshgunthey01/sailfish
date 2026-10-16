import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/schema.js";

/**
 * Backup & restore for the single-tenant SQLite database (no PocketBase in
 * this stack — see PRD §6.1 — so this is plain Node + SQLite instead of pb_hooks).
 *
 * - Backups are consistent snapshots via `VACUUM INTO` (works on a live DB).
 * - Restore replaces the database file, which requires a restart: staging a
 *   restore writes a marker + safety snapshot, and boot applies it BEFORE
 *   the DB is opened (see applyPendingRestore in index.ts).
 */

const KEEP = 7;
const FILE_RE = /^sailfish-\d{8}-\d{6}\.db$/;

export interface BackupInfo {
  file: string;
  bytes: number;
  created_at: string;
}

export function backupDir(dataDir: string): string {
  const d = path.join(dataDir, "backups");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Null unless the name is a legit backup file inside the backup dir. */
export function safePath(dataDir: string, file: string): string | null {
  const base = path.basename(file);
  if (!FILE_RE.test(base)) return null;
  const full = path.join(backupDir(dataDir), base);
  if (!full.startsWith(backupDir(dataDir) + path.sep)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

export function listBackups(dataDir: string): BackupInfo[] {
  const dir = backupDir(dataDir);
  return fs
    .readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, bytes: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.file < b.file ? 1 : -1));
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function createBackup(dataDir: string): BackupInfo {
  const dir = backupDir(dataDir);
  const file = `sailfish-${stamp()}.db`;
  const tmp = path.join(dir, file + ".tmp");
  const tmpLit = `'${tmp.replace(/'/g, "''")}'`;
  getDb().exec(`VACUUM INTO ${tmpLit}`);
  fs.renameSync(tmp, path.join(dir, file));
  pruneBackups(dataDir);
  const st = fs.statSync(path.join(dir, file));
  return { file, bytes: st.size, created_at: st.mtime.toISOString() };
}

export function pruneBackups(dataDir: string): string[] {
  const dir = backupDir(dataDir);
  const doomed = listBackups(dataDir).slice(KEEP);
  for (const b of doomed) {
    try {
      fs.unlinkSync(path.join(dir, b.file));
    } catch {
      /* best effort */
    }
  }
  return doomed.map((b) => b.file);
}

const MARKER = ".restore-requested";

/** Stage a restore: safety snapshot first, then a boot marker. */
export function stageRestore(dataDir: string, file: string): { safety: BackupInfo } {
  if (!safePath(dataDir, file)) throw new Error("unknown backup file");
  const safety = createBackup(dataDir);
  fs.writeFileSync(path.join(dataDir, MARKER), file, "utf-8");
  return { safety };
}

export function pendingRestore(dataDir: string): string | null {
  const m = path.join(dataDir, MARKER);
  if (!fs.existsSync(m)) return null;
  const file = fs.readFileSync(m, "utf-8").trim();
  return safePath(dataDir, file) ? file : null;
}

export function cancelRestore(dataDir: string): boolean {
  const m = path.join(dataDir, MARKER);
  if (!fs.existsSync(m)) return false;
  fs.unlinkSync(m);
  return true;
}

/** Boot hook (call BEFORE initDb): swap in the staged backup file. */
export function applyPendingRestore(dataDir: string): string | null {
  const file = pendingRestore(dataDir);
  if (!file) return null;
  const src = safePath(dataDir, file);
  if (!src) {
    fs.unlinkSync(path.join(dataDir, MARKER));
    return null;
  }
  fs.copyFileSync(src, path.join(dataDir, "sailfish.db"));
  fs.unlinkSync(path.join(dataDir, MARKER));
  return file;
}
