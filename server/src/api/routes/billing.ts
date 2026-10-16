import { Hono } from "hono";
import { billingSummary, dailySummary, syncBilling } from "../../services/billing-sync.js";
import type { Vault } from "../../services/vault.js";
import { ingestTelemetry, burnRateSeries, costByModel, verifyIngestAuth } from "./telemetry-helpers.js";

export function billingRoutes(vault: Vault): Hono {
  const app = new Hono();

  app.get("/summary", (c) => c.json(billingSummary()));

  app.get("/daily", (c) => {
    const days = parseInt(c.req.query("days") ?? "30", 10);
    return c.json(dailySummary(days));
  });

  app.post("/sync", async (c) => {
    const r = await syncBilling(vault);
    return c.json(r, r.ok ? 200 : 502);
  });

  return app;
}

export function telemetryRoutes(vault: Vault): Hono {
  const app = new Hono();

  // client-pushed usage objects (ARCHITECTURE §6.3)
  app.post("/ingest", async (c) => {
    const auth = c.req.header("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const modelKey = vault.get("model_access_key");
    if (!modelKey || !verifyIngestAuth(modelKey, token))
      return c.json({ error: "unauthorized" }, 401);

    const body = await c.req.json<{
      model_id?: string;
      prompt_tokens?: number;
      completion_tokens?: number;
      ts?: string;
      router?: string;
      task?: string;
    }>();
    if (!body.model_id || body.prompt_tokens === undefined || body.completion_tokens === undefined)
      return c.json({ error: "model_id, prompt_tokens, completion_tokens required" }, 400);
    const r = ingestTelemetry({
      model_id: body.model_id,
      prompt_tokens: Math.max(0, Math.floor(body.prompt_tokens)),
      completion_tokens: Math.max(0, Math.floor(body.completion_tokens)),
      ts: body.ts,
      router: typeof body.router === "string" ? body.router.slice(0, 120) : undefined,
      task: typeof body.task === "string" ? body.task.slice(0, 120) : undefined,
    });
    return c.json(r);
  });

  app.get("/series", (c) => {
    const days = parseInt(c.req.query("days") ?? "7", 10);
    const model = c.req.query("model");
    return c.json({ series: burnRateSeries({ days, model }) });
  });

  app.get("/by-model", (c) => {
    const days = parseInt(c.req.query("days") ?? "7", 10);
    return c.json({ by_model: costByModel(days) });
  });

  return app;
}
