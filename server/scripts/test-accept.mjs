import fs from "node:fs";
import { acceptBackupFile } from "../src/services/backup.js";

console.log("real db:", JSON.stringify(acceptBackupFile("./data/sailfish.db")));
fs.writeFileSync("./data/not-a-db.txt", "hello world");
console.log("text file:", JSON.stringify(acceptBackupFile("./data/not-a-db.txt")));
fs.unlinkSync("./data/not-a-db.txt");
console.log("DONE");
