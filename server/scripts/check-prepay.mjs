import { Vault } from "../src/services/vault.ts";
import { DOClient } from "../src/do/client.ts";

const vault = new Vault("data");
const token = vault.get("do_token");
if (!token) { console.log('no token'); process.exit(1); }
const client = new DOClient(token, "");
client.prepaymentConfig().then(res => {
  console.log('prepayment config:', JSON.stringify(res, null, 2));
}).catch(err => {
  console.error('error fetching prepayment config', err);
});
