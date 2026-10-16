import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./data/sailfish.db");
const s = db
  .prepare(
    "SELECT inference_balance, prepaid_amount, account_balance, core_compute_mtd, ai_usage_mtd, tax_mtd, substr(payments_json,1,300) AS payments FROM billing_state WHERE id='singleton'"
  )
  .get();
console.log(JSON.stringify(s));
