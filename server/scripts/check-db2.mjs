import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("./data/sailfish.db");
const info = d.prepare("PRAGMA table_info(billing_state)").all();
console.log("billing_state columns:", info.map(c => c.name + " " + c.type).join(", "));
const row = d.prepare("SELECT * FROM billing_state WHERE id='singleton'").get();
console.log("billing_state row:", JSON.stringify(row, null, 2));
