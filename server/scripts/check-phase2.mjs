import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./data/sailfish.db");
console.log("rates:", JSON.stringify(db.prepare("SELECT * FROM model_rates ORDER BY input_per_1m").all()));
console.log("thresholds cols:", db.prepare("PRAGMA table_info(thresholds)").all().map(c => c.name).join(","));
