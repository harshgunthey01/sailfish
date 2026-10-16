import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Credential vault (ARCHITECTURE.md §9).
 * Secrets are stored AES-256-GCM encrypted in <dataDir>/vault.json.
 * The encryption key is derived (HKDF-SHA256) from a machine secret file that is
 * created on first boot, so secrets never sit in SQLite plaintext and the vault
 * file is unreadable outside the host data volume.
 */

interface VaultFile {
  v: 1;
  salt: string; // hex
  entries: Record<string, string>; // key -> base64(iv|tag|ciphertext)
}

const KEYS = ["do_token", "model_access_key", "smtp_password"] as const;
export type VaultKey = (typeof KEYS)[number];

export class Vault {
  private file: string;
  private keyFile: string;
  private key: Buffer | null = null;
  private data: VaultFile;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "vault.json");
    this.keyFile = path.join(dataDir, ".machine-secret");
    this.data = this.load();
  }

  private machineKey(): Buffer {
    if (this.key) return this.key;
    let secret: string;
    if (fs.existsSync(this.keyFile)) {
      secret = fs.readFileSync(this.keyFile, "utf8").trim();
    } else {
      secret = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(this.keyFile, secret, { mode: 0o600 });
    }
    this.key = Buffer.from(
      crypto.hkdfSync("sha256", secret, "sailfish-vault-salt", "sailfish-vault-v1", 32)
    );
    return this.key;
  }

  private load(): VaultFile {
    if (fs.existsSync(this.file)) {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as VaultFile;
    }
    return { v: 1, salt: crypto.randomBytes(16).toString("hex"), entries: {} };
  }

  private save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 });
  }

  get(k: VaultKey): string | null {
    const enc = this.data.entries[k];
    if (!enc) return null;
    try {
      const buf = Buffer.from(enc, "base64");
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const ct = buf.subarray(28);
      const dec = crypto.createDecipheriv("aes-256-gcm", this.machineKey(), iv);
      dec.setAuthTag(tag);
      return Buffer.concat([dec.update(ct), dec.final()]).toString("utf8");
    } catch {
      return null;
    }
  }

  set(k: VaultKey, value: string) {
    const iv = crypto.randomBytes(12);
    const enc = crypto.createCipheriv("aes-256-gcm", this.machineKey(), iv);
    const ct = Buffer.concat([enc.update(value, "utf8"), enc.final()]);
    this.data.entries[k] = Buffer.concat([iv, enc.getAuthTag(), ct]).toString("base64");
    this.save();
  }

  has(k: VaultKey): boolean {
    return this.get(k) !== null;
  }
}
