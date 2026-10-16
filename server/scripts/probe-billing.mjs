/**
 * Probe DO billing endpoints to see what "core compute" actually shows for this account.
 * Read-only: GET /balance, /invoices, and the open/upcoming invoice summary product breakdown.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../src/services/vault.js";

const vault = new Vault(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const token = vault.get("do_token");
if (!token) {
  console.log("no do_token");
  process.exit(1);
}

async function get(p) {
  const res = await fetch("https://api.digitalocean.com" + p, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, text };
}

const bal = await get("/v2/customers/my/balance");
console.log("== balance ==", bal.status, JSON.stringify(bal.json));

const acct = await get("/v2/account");
console.log("== account ==", acct.status, acct.text.slice(0, 600));

const now = new Date();
const start = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
const end = now.toISOString().slice(0, 10);
const urn = "do:team:" + (acct.json?.account?.team?.uuid ?? "");
if (acct.json?.account?.team?.uuid) {
  const ins = await get(
    `/v2/billing/${encodeURIComponent(urn)}/insights/${start}/${end}?per_page=50`
  );
  console.log("== insights == ", ins.status, JSON.stringify(ins.json)?.slice(0, 2000));
}

const inv = await get("/v2/customers/my/invoices?per_page=10");
console.log("== invoices ==", inv.status);
const invoices = inv.json?.invoices ?? [];
for (const i of invoices) {
  console.log(
    "-",
    i.invoice_id,
    "| period:", i.invoice_period,
    "| status:", i.invoice_status,
    "| amount:", i.invoice_amount
  );
}

// Summarize the open/upcoming invoice (the MTD accrual)
const open = invoices.find((i) => i.invoice_status === "Open" || i.invoice_status === "Upcoming") ?? invoices[0];
if (open) {
  const sum = await get(`/v2/customers/my/invoices/${open.invoice_uuid}/summary`);
  console.log("== summary for", open.invoice_id, "==", sum.status);
  const j = sum.json;
  if (j) {
    console.log("total amount:", j.amount);
    console.log("product_charges:", JSON.stringify(j.product_charges, null, 2)?.slice(0, 3000));
    console.log("overages:", JSON.stringify(j.overages));
    console.log("credits:", JSON.stringify(j.credits_and_adjustments));
  } else {
    console.log(sum.text.slice(0, 500));
  }
}
