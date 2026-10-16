import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/schema.js";
import type { Vault } from "./vault.js";
import { backupDir } from "./backup.js";

/**
 * S3-compatible off-host backups (DO Spaces, AWS S3, R2, MinIO, Wasabi).
 * Credentials live in the vault; non-secret settings in app_extras.
 * All functions take an optional explicit config so onboarding can use
 * one-off credentials without persisting them.
 */

export interface S3Settings {
  endpoint: string;
  bucket: string;
  region: string;
  prefix: string;
  path_style: boolean;
  has_keys: boolean;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  access_key: string;
  secret_key: string;
  prefix?: string;
  path_style?: boolean;
}

const REMOTE_KEEP = 30;

function readRaw(): any {
  try {
    const row = getDb()
      .prepare("SELECT settings_json FROM app_extras WHERE id='singleton'")
      .get() as any;
    return row ? (JSON.parse(row.settings_json)?.s3 ?? {}) : {};
  } catch {
    return {};
  }
}

export function getS3Settings(vault: Vault): S3Settings {
  const s = readRaw();
  return {
    endpoint: s.endpoint ?? "",
    bucket: s.bucket ?? "",
    region: s.region ?? "us-east-1",
    prefix: s.prefix ?? "sailfish/",
    path_style: s.path_style === true,
    has_keys: !!vault.get("s3_access_key") && !!vault.get("s3_secret_key"),
  };
}

export function saveS3Settings(
  vault: Vault,
  patch: Partial<{
    endpoint: string;
    bucket: string;
    region: string;
    prefix: string;
    path_style: boolean;
    access_key: string;
    secret_key: string;
  }>
): S3Settings {
  const db = getDb();
  let settings: any = {};
  try {
    const row = db.prepare("SELECT settings_json FROM app_extras WHERE id='singleton'").get() as any;
    settings = row ? JSON.parse(row.settings_json) : {};
  } catch {
    settings = {};
  }
  const cur = settings.s3 ?? {};
  settings.s3 = {
    endpoint: patch.endpoint ?? cur.endpoint ?? "",
    bucket: patch.bucket ?? cur.bucket ?? "",
    region: patch.region ?? cur.region ?? "us-east-1",
    prefix: patch.prefix ?? cur.prefix ?? "sailfish/",
    path_style: patch.path_style ?? cur.path_style ?? false,
  };
  if (patch.access_key) vault.set("s3_access_key", patch.access_key);
  if (patch.secret_key) vault.set("s3_secret_key", patch.secret_key);
  db.prepare("UPDATE app_extras SET settings_json = ? WHERE id='singleton'").run(
    JSON.stringify(settings)
  );
  return getS3Settings(vault);
}

function resolveConfig(vault: Vault, override?: Partial<S3Config>): { cfg: S3Config; missing: string[] } {
  const s = readRaw();
  const cfg: S3Config = {
    endpoint: override?.endpoint ?? s.endpoint ?? "",
    bucket: override?.bucket ?? s.bucket ?? "",
    region: override?.region ?? s.region ?? "us-east-1",
    access_key: override?.access_key ?? vault.get("s3_access_key") ?? "",
    secret_key: override?.secret_key ?? vault.get("s3_secret_key") ?? "",
    prefix: override?.prefix ?? s.prefix ?? "sailfish/",
    path_style: override?.path_style ?? s.path_style ?? false,
  };
  const missing: string[] = [];
  if (!cfg.endpoint) missing.push("endpoint");
  if (!cfg.bucket) missing.push("bucket");
  if (!cfg.access_key) missing.push("access_key");
  if (!cfg.secret_key) missing.push("secret_key");
  return { cfg, missing };
}

function makeClient(cfg: S3Config): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.path_style ?? false,
    credentials: { accessKeyId: cfg.access_key, secretAccessKey: cfg.secret_key },
  });
}

/** One-off client from explicit credentials (onboarding recovery). Throws on missing fields. */
export function buildClient(override: Partial<S3Config> & { endpoint: string; bucket: string; access_key: string; secret_key: string }): { client: S3Client; cfg: S3Config } {
  const cfg: S3Config = {
    region: "us-east-1",
    prefix: "sailfish/",
    path_style: false,
    ...override,
  };
  const missing = ["endpoint", "bucket", "access_key", "secret_key"].filter(
    (k) => !(cfg as any)[k]
  );
  if (missing.length) throw new Error("missing S3 fields: " + missing.join(", "));
  return { client: makeClient(cfg), cfg };
}

/** Upload after a local snapshot when S3 is configured; never throws. */
export async function uploadIfConfigured(
  vault: Vault,
  dataDir: string,
  file: string
): Promise<{ uploaded: boolean; detail: string }> {
  const s = getS3Settings(vault);
  if (!s.endpoint || !s.bucket || !s.has_keys) return { uploaded: false, detail: "S3 not configured" };
  try {
    const r = await uploadBackup(vault, dataDir, file);
    return { uploaded: true, detail: r.key };
  } catch (e) {
    return { uploaded: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function keyFor(cfg: S3Config, file: string): string {
  const prefix = cfg.prefix ?? "sailfish/";
  const p = prefix.endsWith("/") || prefix === "" ? prefix : prefix + "/";
  return p + file;
}

/** Upload a local backup file. Returns the object key. */
export async function uploadBackup(
  vault: Vault,
  dataDir: string,
  file: string,
  override?: Partial<S3Config>
): Promise<{ key: string; bytes: number }> {
  const { cfg, missing } = resolveConfig(vault, override);
  if (missing.length) throw new Error("S3 not configured: " + missing.join(", "));
  const local = path.join(backupDir(dataDir), path.basename(file));
  if (!fs.existsSync(local)) throw new Error("unknown backup file");
  const body = fs.readFileSync(local);
  const client = makeClient(cfg);
  const key = keyFor(cfg, path.basename(file));
  await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body }));
  await pruneRemote(client, cfg);
  return { key, bytes: body.length };
}

async function pruneRemote(client: S3Client, cfg: S3Config): Promise<string[]> {
  const listed = await listRemote(client, cfg);
  const doomed = listed.slice(REMOTE_KEEP);
  for (const k of doomed) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: k.key }));
    } catch {
      /* best effort */
    }
  }
  return doomed.map((k) => k.key);
}

export async function listRemote(
  client: S3Client,
  cfg: S3Config
): Promise<Array<{ key: string; bytes: number; modified: string }>>;
export async function listRemote(
  vault: Vault,
  override?: Partial<S3Config>
): Promise<Array<{ key: string; bytes: number; modified: string }>>;
export async function listRemote(
  a: S3Client | Vault,
  b?: S3Config | Partial<S3Config>
): Promise<Array<{ key: string; bytes: number; modified: string }>> {
  let client: S3Client;
  let cfg: S3Config;
  if (a instanceof S3Client) {
    client = a;
    cfg = b as S3Config;
  } else {
    const r = resolveConfig(a, b as Partial<S3Config>);
    if (r.missing.length) throw new Error("S3 not configured: " + r.missing.join(", "));
    cfg = r.cfg;
    client = makeClient(cfg);
  }
  const out: Array<{ key: string; bytes: number; modified: string }> = [];
  let token: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: cfg.prefix ?? "sailfish/", ContinuationToken: token })
    );
    for (const o of res.Contents ?? []) {
      if (!o.Key) continue;
      out.push({ key: o.Key, bytes: o.Size ?? 0, modified: o.LastModified?.toISOString() ?? "" });
    }
    if (!res.IsTruncated) break;
    token = res.NextContinuationToken;
  }
  return out.sort((x, y) => (x.key < y.key ? 1 : -1));
}

/** Download a remote object into the local backups dir under a safe name. */
export async function fetchRemote(
  vault: Vault,
  dataDir: string,
  key: string,
  override?: Partial<S3Config>
): Promise<{ file: string; bytes: number }> {
  const { cfg, missing } = resolveConfig(vault, override);
  if (missing.length) throw new Error("S3 not configured: " + missing.join(", "));
  if (key.includes("..") || key.startsWith("/")) throw new Error("invalid key");
  const client = makeClient(cfg);
  const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  const stream = res.Body as unknown as AsyncIterable<Uint8Array>;
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > 500 * 1024 * 1024) throw new Error("remote file too large (>500MB)");
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  if (buf.subarray(0, 16).toString("binary") !== "SQLite format 3\0") {
    throw new Error("remote file is not a SQLite database");
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const file = `sailfish-${stamp.slice(0, 8)}-${stamp.slice(9, 15)}.db`;
  fs.writeFileSync(path.join(backupDir(dataDir), file), buf);
  return { file, bytes: buf.length };
}

/** Connectivity + write-permission probe (writes then deletes a tiny object). */
export async function testS3(
  vault: Vault,
  override?: Partial<S3Config>
): Promise<{ ok: boolean; detail: string }> {
  try {
    const { cfg, missing } = resolveConfig(vault, override);
    if (missing.length) return { ok: false, detail: "S3 not configured: " + missing.join(", ") };
    const client = makeClient(cfg);
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    const key = (cfg.prefix ?? "sailfish/") + ".sailfish-write-test";
    await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: "ok" }));
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return { ok: true, detail: `bucket ${cfg.bucket} reachable, write ok` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
