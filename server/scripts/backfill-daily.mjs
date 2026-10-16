/**
 * One-time backfill of billing_daily from 90 days of DO Billing Insights.
 * After this, the regular sync maintains it incrementally.
 * Usage: npx tsx scripts/backfill-daily.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb } from "../src/db/schema.js";
import { Vault } from "../src/services/vault.js";
import { DOClient } from "../src/do/client.js";
import { writeBillingDaily } from "../src/services/billing-sync.js";

const root = path.dirname(fileURLToPath(import.meta.url));
initDb(path.join(root, "..", "data"));
const vault = new Vault(path.join(root, "..", "data"));
const doToken = vault.get("do_token");
if (!doToken) {
  console.log("no do_token");
  process.exit(1);
}

const client = new DOClient(doToken, "");
const acct = await client.account();
if (!acct.team_uuid) {
  console.log("no team uuid");
  process.exit(1);
}
const urn = `do:team:${acct.team_uuid}`;
const db = getDb();
const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
let total = 0;
for (const [backStart, backEnd] of [
  [90, 60],
  [60, 30],
  [30, 0],
]) {
  const start = iso(new Date(now.getTime() - backStart * 86400000));
  const end = iso(new Date(now.getTime() - backEnd * 86400000));
  const points = await client.billingInsights(urn, start, end);
  writeBillingDaily(db, points);
  total += points.length;
  console.log(`${start}..${end}: ${points.length} lines`);
}
console.log(`total lines: ${total}`);
console.log(
  JSON.stringify(
    db.prepare("SELECT COUNT(*) AS rows, COUNT(DISTINCT day) AS days, ROUND(SUM(amount_usd),2) AS usd FROM billing_daily").get()
  )
);
