import { getDb, newId } from "../db/schema.js";

/**
 * DigitalOcean platform status (MONITORING.md Phase 3/C1).
 * Public Statuspage feed, no auth. Unresolved incidents drive the
 * dashboard banner so a failed router call reads as "DO incident".
 */

const STATUS_URL = "https://status.digitalocean.com/api/v2/summary.json";

export interface StatusIncident {
  id: string;
  name: string;
  status: string;
  shortlink: string;
}

export async function pollDoStatus(): Promise<{ ok: boolean; unresolved: number; detail: string }> {
  const db = getDb();
  try {
    const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, unresolved: -1, detail: `status ${res.status}` };
    const j = (await res.json()) as any;
    const incidents = (j.incidents ?? []) as any[];
    for (const i of incidents) {
      if (!i?.id) continue;
      const resolved = i.status === "resolved" ? 1 : 0;
      db.prepare(
        `INSERT INTO do_incidents (id, name, status, shortlink, updated_at, resolved)
         VALUES (?,?,?,?,datetime('now'),?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, status = excluded.status,
           shortlink = excluded.shortlink, updated_at = excluded.updated_at,
           resolved = excluded.resolved`
      ).run(
        String(i.id),
        String(i.name ?? "incident"),
        String(i.status ?? "unknown"),
        String(i.shortlink ?? ""),
        resolved
      );
    }
    db.prepare(`DELETE FROM do_incidents WHERE resolved = 1 AND updated_at < datetime('now', '-7 days')`).run();
    const n = (db.prepare("SELECT COUNT(*) AS n FROM do_incidents WHERE resolved = 0").get() as any).n;
    return { ok: true, unresolved: n, detail: `${incidents.length} incident(s) in feed` };
  } catch (e) {
    return { ok: false, unresolved: -1, detail: e instanceof Error ? e.message : String(e) };
  }
}

export function unresolvedIncidents(): { incidents: StatusIncident[]; checked_at: string | null } {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, name, status, shortlink FROM do_incidents WHERE resolved = 0 ORDER BY updated_at DESC")
    .all() as unknown as StatusIncident[];
  const chk = db.prepare("SELECT MAX(updated_at) AS ts FROM do_incidents").get() as { ts: string | null };
  return { incidents: rows, checked_at: chk.ts };
}

export function insertTestIncident(name = "TEST incident (delete me)"): string {
  const id = "test-" + newId();
  getDb()
    .prepare("INSERT INTO do_incidents (id, name, status, shortlink) VALUES (?,?,?,?)")
    .run(id, name, "investigating", "");
  return id;
}
