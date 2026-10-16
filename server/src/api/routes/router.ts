import { Hono } from "hono";
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  moveRule,
  takeSnapshot,
  listSnapshots,
  rollbackSnapshot,
  whatIfEstimate,
} from "../../services/router-engine.js";

export function routerRoutes(): Hono {
  const app = new Hono();

  app.get("/rules", (c) => c.json({ rules: listRules(), plan: whatIfEstimate() }));

  app.post("/rules", async (c) => {
    const b = await c.req.json<{
      rule_name?: string;
      target_model?: string;
      priority_metric?: "Cost" | "Latency";
      cost_weight?: number;
      is_active?: boolean;
    }>();
    if (!b.rule_name || !b.target_model) return c.json({ error: "rule_name and target_model required" }, 400);
    const rule = createRule({
      rule_name: b.rule_name,
      target_model: b.target_model,
      priority_metric: b.priority_metric ?? "Cost",
      cost_weight: b.cost_weight,
      is_active: b.is_active,
    });
    return c.json({ rule }, 201);
  });

  app.patch("/rules/:id", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const rule = updateRule(c.req.param("id"), b as any);
    if (!rule) return c.json({ error: "not found" }, 404);
    return c.json({ rule });
  });

  app.delete("/rules/:id", (c) => {
    return deleteRule(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });

  app.post("/rules/:id/move", async (c) => {
    const b = await c.req.json<{ dir?: number }>();
    moveRule(c.req.param("id"), b.dir === -1 ? -1 : 1);
    return c.json({ ok: true });
  });

  app.get("/snapshots", (c) => c.json({ snapshots: listSnapshots() }));

  app.post("/snapshots", async (c) => {
    const b = await c.req.json<{ label?: string }>();
    const id = takeSnapshot(b.label ?? `manual ${new Date().toISOString()}`);
    return c.json({ id }, 201);
  });

  app.post("/snapshots/:id/rollback", (c) => {
    return rollbackSnapshot(c.req.param("id"))
      ? c.json({ ok: true })
      : c.json({ error: "not found" }, 404);
  });

  return app;
}
