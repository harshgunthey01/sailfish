import { getDb, newId, nowIso } from "../db/schema.js";

/**
 * Router engine (PRD §2.3, ARCHITECTURE §6.4).
 * Rules are stored ordered; each has a priority_metric (Cost|Latency) and a
 * 0..100 cost_weight from the UI slider. In billing-only mode this is an offline
 * advisor: ordering + weights produce a ranked routing plan, and a what-if cost
 * estimate against recent telemetry.
 */

export interface RouterRule {
  id: string;
  rule_name: string;
  target_model: string;
  priority_metric: "Cost" | "Latency";
  is_active: number;
  position: number;
  cost_weight: number;
}

export function listRules(): RouterRule[] {
  return getDb()
    .prepare("SELECT * FROM router_rules ORDER BY position ASC, rowid ASC")
    .all() as unknown as RouterRule[];
}

export function createRule(input: {
  rule_name: string;
  target_model: string;
  priority_metric: "Cost" | "Latency";
  cost_weight?: number;
  is_active?: boolean;
}): RouterRule {
  const db = getDb();
  const maxPos = (
    db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM router_rules").get() as { m: number }
  ).m;
  const id = newId();
  db.prepare(
    `INSERT INTO router_rules (id, rule_name, target_model, priority_metric, is_active, position, cost_weight)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    id,
    input.rule_name,
    input.target_model,
    input.priority_metric,
    input.is_active === false ? 0 : 1,
    maxPos + 1,
    clamp(input.cost_weight ?? (input.priority_metric === "Cost" ? 80 : 20))
  );
  return getRule(id)!;
}

export function updateRule(id: string, patch: Partial<Omit<RouterRule, "id">>): RouterRule | null {
  const db = getDb();
  const existing = getRule(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  db.prepare(
    `UPDATE router_rules SET rule_name=?, target_model=?, priority_metric=?, is_active=?, position=?, cost_weight=?
     WHERE id=?`
  ).run(
    merged.rule_name,
    merged.target_model,
    merged.priority_metric,
    merged.is_active,
    merged.position,
    clamp(merged.cost_weight),
    id
  );
  return getRule(id);
}

export function deleteRule(id: string): boolean {
  const res = getDb().prepare("DELETE FROM router_rules WHERE id = ?").run(id);
  return Number(res.changes) > 0;
}

export function getRule(id: string): RouterRule | null {
  return (
    (getDb().prepare("SELECT * FROM router_rules WHERE id = ?").get(id) as unknown as RouterRule) ??
    null
  );
}

export function moveRule(id: string, dir: -1 | 1) {
  const rules = listRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const swapWith = idx + dir;
  if (swapWith < 0 || swapWith >= rules.length) return;
  const a = rules[idx]!;
  const b = rules[swapWith]!;
  const db = getDb();
  db.prepare("UPDATE router_rules SET position = ? WHERE id = ?").run(b.position, a.id);
  db.prepare("UPDATE router_rules SET position = ? WHERE id = ?").run(a.position, b.id);
}

/** Ranked routing plan: active rules ordered, biased by metric + weight. */
export function routingPlan(): Array<{ rule: RouterRule; score: number }> {
  return listRules()
    .filter((r) => r.is_active === 1)
    .map((r) => ({
      rule: r,
      score:
        (r.priority_metric === "Cost" ? r.cost_weight : 100 - r.cost_weight) - r.position * 0.01,
    }))
    .sort((a, b) => b.score - a.score);
}

/** What-if: estimated daily cost if traffic followed the plan weights. */
export function whatIfEstimate() {
  const db = getDb();
  const recent = db
    .prepare(
      `SELECT model_id, SUM(cost_usd) AS cost, SUM(requests) AS req
       FROM telemetry_hourly WHERE hour_ts >= datetime('now','-7 days') GROUP BY model_id`
    )
    .all() as Array<{ model_id: string; cost: number; req: number }>;
  const plan = routingPlan();
  return { recent, plan: plan.map((p) => ({ rule: p.rule, score: round2(p.score) }) ) };
}

// ---- snapshots (PRD §2.3 version control) ----
export function takeSnapshot(label: string): string {
  const id = newId();
  getDb()
    .prepare("INSERT INTO router_snapshots (id, label, rules_json) VALUES (?,?,?)")
    .run(id, label, JSON.stringify(listRules()));
  return id;
}

export function listSnapshots() {
  return getDb().prepare("SELECT id, ts, label FROM router_snapshots ORDER BY ts DESC").all();
}

export function rollbackSnapshot(id: string): boolean {
  const db = getDb();
  const snap = db.prepare("SELECT rules_json FROM router_snapshots WHERE id = ?").get(id) as
    | { rules_json: string }
    | undefined;
  if (!snap) return false;
  const rules = JSON.parse(snap.rules_json) as RouterRule[];
  // append-only history: snapshot current state before rollback
  takeSnapshot(`pre-rollback ${nowIso()}`);
  db.prepare("DELETE FROM router_rules").run();
  const ins = db.prepare(
    `INSERT INTO router_rules (id, rule_name, target_model, priority_metric, is_active, position, cost_weight)
     VALUES (?,?,?,?,?,?,?)`
  );
  for (const r of rules) {
    ins.run(r.id, r.rule_name, r.target_model, r.priority_metric, r.is_active, r.position, r.cost_weight);
  }
  return true;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
