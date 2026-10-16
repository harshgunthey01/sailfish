/**
 * Verify budgets CRUD + digest builder (no emails sent; SMTP-dependent paths
 * only check graceful failure). Cleans up its test budget.
 * Usage: npx tsx scripts/test-budget-digest.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb } from "../src/db/schema.js";
import { buildDigest, getDigestSettings } from "../src/services/digest.js";
import { budgetProgress, evaluateBudgets, budgetSpend } from "../src/services/billing-sync.js";

initDb(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const db = getDb();

// 1. digest builder output (pure read)
const body = buildDigest();
console.log("=== digest preview (first 700 chars) ===");
console.log(body.slice(0, 700));
console.log("=== digest settings ===", JSON.stringify(getDigestSettings()));

// 2. budget evaluation with a throwaway budget row
const before = db.prepare("SELECT COUNT(*) AS n FROM budgets").get().n;
const id = "test-budget-1";
db.prepare(
  `INSERT INTO budgets (id, name, scope, amount_usd, alerts_json, channels_json)
   VALUES (?, 'test AI budget', 'ai', 50, '[50,80,100]', '[]')`
).run(id);
const spend = budgetSpend(db);
console.log("spend basis:", JSON.stringify(spend));
const breaches = evaluateBudgets(db, spend);
console.log("breaches:", JSON.stringify(breaches));
const prog = budgetProgress();
console.log("progress:", JSON.stringify(prog.budgets.map((b) => ({ name: b.name, pct: b.pct, projected: b.projected_eom_usd, over: b.on_pace_to_exceed }))));
// rerun: already-fired levels must stay silent
console.log("rerun:", JSON.stringify(evaluateBudgets(db, spend)));
// cleanup
db.prepare("DELETE FROM budgets WHERE id = ?").run(id);
console.log("budgets after cleanup:", db.prepare("SELECT COUNT(*) AS n FROM budgets").get().n, "(was", before + ")");
console.log("DONE");
