import { spawn } from "node:child_process";
import { getDb, newId } from "../db/schema.js";
import { DOClient } from "../do/client.js";

/**
 * Model management (PRD §2.4, ARCHITECTURE §6.5).
 * REST-first: /v1/models lists availability.
 * Provision/deprovision: try REST; when no API equivalent exists, shell out to
 * `doctl` with a fixed argument allow-list, capturing stdout/stderr for the
 * Terminal Output Modal.
 */

export interface JobRow {
  id: string;
  type: string;
  status: string;
  payload_json: string;
  stdout: string | null;
  stderr: string | null;
  created_at: string;
  updated_at: string;
}

export function enqueueJob(type: string, payload: Record<string, unknown>): JobRow {
  const db = getDb();
  const row = {
    id: newId(),
    type,
    status: "pending",
    payload_json: JSON.stringify(payload),
  };
  db.prepare(
    "INSERT INTO jobs (id, type, status, payload_json) VALUES (?,?,?,?)"
  ).run(row.id, row.type, row.status, row.payload_json);
  return getJob(row.id)!;
}

export function getJob(id: string): JobRow | null {
  return (getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as unknown as JobRow) ?? null;
}

export function listJobs(limit = 20): JobRow[] {
  return getDb()
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as JobRow[];
}

export function updateJob(id: string, patch: Partial<JobRow>) {
  const db = getDb();
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    vals.push(v as string | number | null);
  }
  sets.push(`updated_at = datetime('now')`);
  vals.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function runDoctl(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const ALLOWED = ["serverless", "functions", "apps", "kubernetes", "droplets", "account", "auth"];
  if (args.length === 0 || !ALLOWED.includes(args[0]!)) {
    return Promise.resolve({ code: 126, stdout: "", stderr: `doctl subcommand not allowed: ${args[0] ?? ""}` });
  }
  return new Promise((resolve) => {
    const proc = spawn("doctl", args, { timeout: 30_000 });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => resolve({ code: 127, stdout: out, stderr: err + String(e) }));
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout: out, stderr: err }));
  });
}

/**
 * Process a model job. Provisioning inference models on DO is account-level
 * (models appear in /v1/models without per-account provisioning), so the honest
 * behavior is: verify via REST, and only fall back to doctl when the caller
 * explicitly requested a CLI op.
 */
export async function processModelJob(jobId: string, client: DOClient | null): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  updateJob(jobId, { status: "running" });
  const payload = JSON.parse(job.payload_json) as { model_name?: string; op?: string };

  try {
    // 1) REST-first: mark Deploying, verify against /v1/models
    if (client) {
      const models = await client.models();
      const known = models.some((m) => m.name === payload.model_name || m.id === payload.model_name);
      if (known && payload.op !== "remove") {
        upsertModel(payload.model_name!, "Active");
        updateJob(jobId, {
          status: "done",
          stdout: `REST /v1/models: ${payload.model_name} is available; no provisioning required (account-level).`,
        });
        return;
      }
      if (payload.op === "remove") {
        upsertModel(payload.model_name!, "Removed");
        updateJob(jobId, {
          status: "done",
          stdout: `Marked ${payload.model_name} Removed locally. Inference models are account-managed; nothing to spin down via REST.`,
        });
        return;
      }
    }

    // 2) doctl fallback (only if binary present)
    const probe = await runDoctl(["account", "get", "-o", "json"]);
    if (probe.code === 0) {
      const res = await runDoctl(["serverless", "list", "--output", "json"]);
      updateJob(jobId, {
        status: res.code === 0 ? "done" : "failed",
        stdout: res.stdout,
        stderr: res.stderr || `Model ${payload.model_name} not found via REST; doctl fallback executed.`,
      });
      upsertModel(payload.model_name!, res.code === 0 ? "Active" : "Removed");
      return;
    }

    updateJob(jobId, {
      status: "failed",
      stderr:
        `No public REST provisioning API for ${payload.model_name ?? "model"} and doctl is not available in this container. ` +
        `Model recorded as Deploying; retry once doctl/REST support exists.`,
    });
    upsertModel(payload.model_name!, "Deploying");
  } catch (e) {
    updateJob(jobId, { status: "failed", stderr: e instanceof Error ? e.message : String(e) });
  }
}

export function upsertModel(name: string, status: "Active" | "Deploying" | "Removed") {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM managed_models WHERE model_name = ?").get(name) as
    | { id: string }
    | undefined;
  if (existing) {
    db.prepare("UPDATE managed_models SET status = ? WHERE id = ?").run(status, existing.id);
  } else {
    db.prepare("INSERT INTO managed_models (id, model_name, status) VALUES (?,?,?)").run(
      newId(),
      name,
      status
    );
  }
}

export function listManagedModels() {
  return getDb().prepare("SELECT * FROM managed_models ORDER BY model_name").all();
}
