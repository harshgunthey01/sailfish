import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./data/sailfish.db");
console.log(
  JSON.stringify(
    db
      .prepare(
        "SELECT inference_balance, prepaid_amount, account_balance, core_compute_mtd, ai_usage_mtd, tax_mtd FROM billing_state WHERE id='singleton'"
      )
      .get()
  )
);
