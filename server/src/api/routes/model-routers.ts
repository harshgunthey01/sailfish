import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DOClient, DOError } from "../../do/client.js";
import type { Vault } from "../../services/vault.js";
import type { ModelRouterInput, ModelRouterTaskPolicy } from "../../do/client.js";

/**
 * Live DigitalOcean GenAI Model Router proxy (control plane).
 *
 * DO removed the ability to edit inference routers from the control panel, so
 * these routes expose `/v2/gen-ai/models/routers` to the admin UI:
 *   GET    /api/v1/model-routers          -> list
 *   POST   /api/v1/model-routers          -> create
 *   GET    /api/v1/model-routers/:uuid    -> retrieve
 *   PUT    /api/v1/model-routers/:uuid    -> update
 *   DELETE /api/v1/model-routers/:uuid    -> delete
 *
 * All of these sit behind the admin-session middleware in index.ts.
 *
 * NOTE: These routes only need the DO OAuth token (do_token), NOT model_access_key.
 */
export function modelRouterRoutes(vault: Vault): Hono {
  const app = new Hono();

  // Build a lightweight DOClient that uses only the OAuth token for control-plane calls.
  function clientOrError(c: any): DOClient | undefined {
    const tok = vault.get("do_token");
    if (!tok) {
      c.status(400);
      return undefined;
    }
    return new DOClient(tok, "");
  }

  function noCreds(c: any) {
    return c.json(
      {
        error: "DigitalOcean token not configured. Add it in Settings.",
        code: "no_creds",
      },
      400
    );
  }

  app.get("/", async (c) => {
    const client = clientOrError(c);
    if (!client) return noCreds(c);
    try {
      const routers = await client.listModelRouters();
      return c.json({ routers, source: "live" });
    } catch (e) {
      console.error("[model-routers] list:", errMessage(e));
      return c.json({ error: errMessage(e), code: "do_error" }, doStatus(e));
    }
  });

  app.post("/", async (c) => {
    const client = clientOrError(c);
    if (!client) return noCreds(c);
    const body = await c.req.json<Record<string, unknown>>();
    const parsed = normalizeInput(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    try {
      const router = await client.createModelRouter(parsed.input);
      return c.json({ router }, 201);
    } catch (e) {
      return c.json({ error: errMessage(e), code: "do_error" }, doStatus(e));
    }
  });

  app.get("/:uuid", async (c) => {
    const client = clientOrError(c);
    if (!client) return noCreds(c);
    try {
      const router = await client.getModelRouter(c.req.param("uuid"));
      return c.json({ router });
    } catch (e) {
      return c.json({ error: errMessage(e), code: "do_error" }, doStatus(e));
    }
  });

  app.put("/:uuid", async (c) => {
    const client = clientOrError(c);
    if (!client) return noCreds(c);
    const body = await c.req.json<Record<string, unknown>>();
    const parsed = normalizeInput(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    try {
      const router = await client.updateModelRouter(c.req.param("uuid"), parsed.input);
      return c.json({ router });
    } catch (e) {
      return c.json({ error: errMessage(e), code: "do_error" }, doStatus(e));
    }
  });

  app.delete("/:uuid", async (c) => {
    const client = clientOrError(c);
    if (!client) return noCreds(c);
    try {
      await client.deleteModelRouter(c.req.param("uuid"));
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: errMessage(e), code: "do_error" }, doStatus(e));
    }
  });

  return app;
}

/** Validate + shape an incoming router payload for the DO API. */
function normalizeInput(
  body: Record<string, unknown>
): { input: ModelRouterInput } | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "name is required" };
  if (!/^[a-z0-9-]+$/.test(name))
    return { error: "name must be lowercase and contain only a-z, 0-9 and hyphens" };

  const fallback = toStringArray(body.fallback_models);
  if (fallback.length === 0)
    return { error: "at least one fallback model is required" };

  const policies: ModelRouterTaskPolicy[] = Array.isArray(body.policies)
    ? (body.policies as any[]).map(toPolicy).filter((p): p is ModelRouterTaskPolicy => p !== null)
    : [];

  const input: ModelRouterInput = {
    name,
    fallback_models: fallback,
    policies,
  };
  if (typeof body.description === "string" && body.description.trim())
    input.description = body.description.trim();

  // `regions` is deprecated in the DO API; only send ["all"] when explicitly asked.
  const regions = toStringArray(body.regions);
  if (regions.length) input.regions = regions;

  return { input };
}

function toPolicy(raw: any): ModelRouterTaskPolicy | null {
  if (!raw || typeof raw !== "object") return null;
  const models = toStringArray(raw.models);
  const slug = typeof raw.task_slug === "string" ? raw.task_slug.trim() : "";
  if (!slug && models.length === 0) return null;
  const policy: ModelRouterTaskPolicy = {};
  if (slug) policy.task_slug = slug;
  if (models.length) policy.models = models;
  const prefer =
    raw?.selection_policy && typeof raw.selection_policy.prefer === "string"
      ? raw.selection_policy.prefer
      : typeof raw.prefer === "string"
        ? raw.prefer
        : "";
  if (prefer) policy.selection_policy = { prefer };
  if (raw.custom_task && typeof raw.custom_task === "object") {
    const ct: ModelRouterTaskDetailsLike = {};
    if (typeof raw.custom_task.name === "string") ct.name = raw.custom_task.name;
    if (typeof raw.custom_task.description === "string")
      ct.description = raw.custom_task.description;
    if (Object.keys(ct).length) policy.custom_task = ct;
  }
  return policy;
}

interface ModelRouterTaskDetailsLike {
  name?: string;
  description?: string;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) {
    if (typeof v === "string")
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  }
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Surface DO's real HTTP status (e.g. 403 on managed routers) instead of a blanket 502. */
function doStatus(e: unknown): ContentfulStatusCode {
  const s = e instanceof DOError ? e.status : 502;
  return s as ContentfulStatusCode;
}
