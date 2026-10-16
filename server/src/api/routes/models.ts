import { Hono } from "hono";
import { getDb } from "../../db/schema.js";
import { makeClient } from "../../services/billing-sync.js";
import {
  enqueueJob,
  getJob,
  listJobs,
  processModelJob,
  listManagedModels,
  upsertModel,
} from "../../services/model-manager.js";
import type { Vault } from "../../services/vault.js";

export function modelRoutes(vault: Vault): Hono {
  const app = new Hono();

  // merged view: DO available models + managed lifecycle states
  app.get("/", async (c) => {
    const managed = listManagedModels() as Array<{
      id: string;
      model_name: string;
      status: string;
    }>;
    const client = makeClient(vault);
    let available: unknown[] = [];
    let source = "cache";
    if (client) {
      try {
        available = await client.models();
        source = "live";
      } catch {
        /* fall back to managed-only */
      }
    }
    return c.json({ managed, available, source });
  });

  app.post("/", async (c) => {
    const b = await c.req.json<{ model_name?: string }>();
    if (!b.model_name) return c.json({ error: "model_name required" }, 400);
    upsertModel(b.model_name, "Deploying");
    const job = enqueueJob("model_add", { model_name: b.model_name, op: "add" });
    // fire-and-forget async processing (PRD: background provisioning)
    void processModelJob(job.id, makeClient(vault));
    return c.json({ job: job.id }, 202);
  });

  app.delete("/:name", (c) => {
    const name = decodeURIComponent(c.req.param("name"));
    upsertModel(name, "Removed");
    const job = enqueueJob("model_remove", { model_name: name, op: "remove" });
    void processModelJob(job.id, makeClient(vault));
    return c.json({ job: job.id }, 202);
  });

  app.get("/jobs", (c) => c.json({ jobs: listJobs() }));

  app.get("/jobs/:id", (c) => {
    const job = getJob(c.req.param("id"));
    return job ? c.json({ job }) : c.json({ error: "not found" }, 404);
  });

  return app;
}
