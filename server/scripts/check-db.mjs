import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("./data/sailfish.db");
const rows = d.prepare("SELECT email, id, created_at FROM admins LIMIT 1").all();
console.log("admins:", rows);
const s = d.prepare("SELECT setup_complete, do_auth_configured FROM app_settings LIMIT 1").all();
console.log("settings:", s);
