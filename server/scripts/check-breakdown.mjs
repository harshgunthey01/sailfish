import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("./data/sailfish.db");
const row = d.prepare("SELECT breakdown_json FROM billing_state WHERE id='singleton'").get();
if (row) {
  const bd = JSON.parse(row.breakdown_json ?? "[]");
  for (const p of bd.slice(0, 40)) {
    const amt = parseFloat(p.total_amount) || 0;
    console.log((amt < 0 ? "CRED" : "    "), p.total_amount?.padStart(10), p.sku?.slice(0, 30), "|", p.description?.slice(0, 60));
  }
  console.log("---");
  const byType = { ai: 0, core: 0, tax: 0, credit: 0 };
  for (const p of bd) {
    const amt = parseFloat(p.total_amount) || 0;
    const sku = (p.sku ?? "").toUpperCase();
    if (sku.startsWith("1-DO-ADJMT-00TAX")) byType.tax += amt;
    else if (sku.startsWith("1-AI-")) byType.ai += amt;
    else if (amt < 0) byType.credit += amt;
    else byType.core += amt;
  }
  console.log(byType);
}
