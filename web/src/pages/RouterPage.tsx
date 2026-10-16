import React, { useEffect, useState } from "react";
import {
  Grid,
  Column,
  Accordion,
  AccordionItem,
  Slider,
  Dropdown,
  Toggle,
  TextInput,
  TextArea,
  Select,
  SelectItem,
  Button,
  InlineLoading,
  InlineNotification,
  Tag,
} from "@carbon/react";
import {
  api,
  routerApi,
  type RemoteModelRouter,
  type RouterPayload,
  type RouterPolicy,
} from "../api";

interface Rule {
  id: string;
  rule_name: string;
  target_model: string;
  priority_metric: "Cost" | "Latency";
  is_active: number;
  position: number;
  cost_weight: number;
}

interface PolicyDraft {
  task_slug: string;
  models: string;
  prefer: string;
}

const PREFER_OPTIONS = ["cheapest", "fastest", "none"];
const emptyPolicy = (): PolicyDraft => ({ task_slug: "", models: "", prefer: "cheapest" });

export default function RouterPage() {
  // ---- live DigitalOcean model routers ----
  const [remote, setRemote] = useState<RemoteModelRouter[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fallback, setFallback] = useState("");
  const [policies, setPolicies] = useState<PolicyDraft[]>([emptyPolicy()]);

  // ---- local offline-advisor rules ----
  const [rules, setRules] = useState<Rule[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [ruleName, setRuleName] = useState("");
  const [ruleModel, setRuleModel] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRemote = () =>
    routerApi
      .list()
      .then((r) => {
        setRemote(r.routers);
        setRemoteError(null);
      })
      .catch((e) => setRemoteError(e?.body?.error ?? e?.message ?? "Failed to load routers"))
      .finally(() => setLoadingRemote(false));

  const loadLocal = () =>
    Promise.all([
      api.get<{ rules: Rule[] }>("/router/rules"),
      api.get<{ available: any[]; managed: any[] }>("/models"),
      api.get<{ snapshots: any[] }>("/router/snapshots"),
    ])
      .then(([r, m, s]) => {
        setRules(r.rules);
        const names = new Set<string>();
        (m.available as any[]).forEach((x: any) => names.add(x.name ?? x.id));
        (m.managed as any[]).forEach((x: any) => names.add(x.model_name));
        setModels(Array.from(names).sort());
        setSnapshots(s.snapshots as any[]);
      })
      .catch(() => {});

  useEffect(() => {
    loadRemote();
    loadLocal();
  }, []);

  function resetForm() {
    setEditingUuid(null);
    setName("");
    setDescription("");
    setFallback("");
    setPolicies([emptyPolicy()]);
  }

  function startEdit(r: RemoteModelRouter) {
    setEditingUuid(r.uuid);
    setName(r.name ?? "");
    setDescription(r.description ?? "");
    setFallback((r.config?.fallback_models ?? []).join(", "));
    const ps = (r.config?.policies ?? []).map((p) => ({
      task_slug: p.task_slug ?? "",
      models: (p.models ?? []).join(", "),
      prefer: p.selection_policy?.prefer ?? "cheapest",
    }));
    setPolicies(ps.length ? ps : [emptyPolicy()]);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildPayload(): RouterPayload | { error: string } {
    if (!name.trim()) return { error: "Router name is required." };
    const fb = fallback
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (fb.length === 0) return { error: "At least one fallback model is required." };
    const pol: RouterPolicy[] = policies
      .map((p) => ({
        task_slug: p.task_slug.trim(),
        models: p.models
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        selection_policy: { prefer: p.prefer },
      }))
      .filter((p) => p.task_slug || (p.models && p.models.length > 0));
    return {
      name: name.trim(),
      description: description.trim() || undefined,
      fallback_models: fb,
      policies: pol,
    };
  }

  async function submit() {
    const payload = buildPayload();
    if ("error" in payload) {
      setNotice({ kind: "error", text: payload.error });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      if (editingUuid) {
        await routerApi.update(editingUuid, payload);
        setNotice({ kind: "success", text: `Updated router “${payload.name}”.` });
      } else {
        await routerApi.create(payload);
        setNotice({ kind: "success", text: `Created router “${payload.name}”.` });
      }
      resetForm();
      await loadRemote();
    } catch (e: any) {
      setNotice({ kind: "error", text: e?.body?.error ?? e?.message ?? "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(uuid: string, routerName: string) {
    if (!window.confirm(`Delete model router “${routerName}”? This cannot be undone.`)) return;
    try {
      await routerApi.remove(uuid);
      setNotice({ kind: "success", text: `Deleted router “${routerName}”.` });
      if (editingUuid === uuid) resetForm();
      await loadRemote();
    } catch (e: any) {
      setNotice({ kind: "error", text: e?.body?.error ?? e?.message ?? "Delete failed" });
    }
  }

  return (
    <Grid narrow className="sf-content">
      <Column sm={4} md={8} lg={16}>
        <h3>Inference Router</h3>
        <p className="sf-muted">
          Manage the live DigitalOcean GenAI model routers (routing policies, fallback
          models, selection strategy). DigitalOcean no longer exposes these in the
          control panel, so edits made here are pushed straight to the API.
        </p>
      </Column>

      {notice && (
        <Column sm={4} md={8} lg={16}>
          <InlineNotification
            lowContrast
            kind={notice.kind}
            title={notice.kind === "success" ? "Done" : "Error"}
            subtitle={notice.text}
            onCloseButtonClick={() => setNotice(null)}
            style={{ marginBottom: "1rem" }}
          />
        </Column>
      )}

      {/* ---------- create / edit form ---------- */}
      <Column sm={4} md={8} lg={16}>
        <h4 style={{ marginBottom: "0.75rem" }}>
          {editingUuid ? `Edit router` : "Create a model router"}
        </h4>
      </Column>

      <Column sm={4} md={8} lg={8}>
        <TextInput
          id="mr-name"
          labelText="Name"
          helperText="lowercase, a-z / 0-9 / hyphens only"
          placeholder="my-model-router"
          value={name}
          onChange={(e: any) => setName(e.target.value)}
          style={{ marginBottom: "1rem" }}
        />
      </Column>
      <Column sm={4} md={8} lg={8}>
        <TextArea
          id="mr-desc"
          labelText="Description"
          placeholder="Routes chat traffic across multiple models"
          value={description}
          onChange={(e: any) => setDescription(e.target.value)}
          style={{ marginBottom: "1rem" }}
        />
      </Column>

      <Column sm={4} md={8} lg={16}>
        <TextInput
          id="mr-fallback"
          labelText="Fallback models"
          helperText="Comma-separated. Order defines failover priority, e.g. openai-gpt-oss-120b, qwen3-32b"
          placeholder="openai-gpt-oss-120b, qwen3-32b"
          value={fallback}
          onChange={(e: any) => setFallback(e.target.value)}
          style={{ marginBottom: "1rem" }}
        />
      </Column>

      <Column sm={4} md={8} lg={16}>
        <div className="sf-muted" style={{ marginBottom: "0.5rem" }}>
          Routing policies (task → candidate models → selection strategy)
        </div>
      </Column>

      {policies.map((p, i) => (
        <Column key={i} sm={4} md={8} lg={16}>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              alignItems: "flex-end",
              flexWrap: "wrap",
              marginBottom: "0.75rem",
            }}
          >
            <TextInput
              id={`pol-slug-${i}`}
              labelText="Task slug"
              placeholder="summarization"
              value={p.task_slug}
              onChange={(e: any) =>
                setPolicies((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, task_slug: e.target.value } : x))
                )
              }
              style={{ flex: "1 1 200px" }}
            />
            <TextInput
              id={`pol-models-${i}`}
              labelText="Models (comma-separated)"
              placeholder="openai-gpt-oss-120b, qwen3-32b"
              value={p.models}
              onChange={(e: any) =>
                setPolicies((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, models: e.target.value } : x))
                )
              }
              style={{ flex: "2 1 280px" }}
            />
            <Select
              id={`pol-prefer-${i}`}
              labelText="Prefer"
              value={p.prefer}
              onChange={(e: any) =>
                setPolicies((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, prefer: e.target.value } : x))
                )
              }
              style={{ flex: "0 1 160px" }}
            >
              {PREFER_OPTIONS.map((o) => (
                <SelectItem key={o} value={o} text={o} />
              ))}
            </Select>
            <Button
              kind="ghost"
              size="sm"
              disabled={policies.length === 1}
              onClick={() => setPolicies((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        </Column>
      ))}

      <Column sm={4} md={8} lg={16}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem", flexWrap: "wrap" }}>
          <Button
            kind="tertiary"
            size="sm"
            onClick={() => setPolicies((prev) => [...prev, emptyPolicy()])}
          >
            + Add policy
          </Button>
          <Button kind="primary" disabled={saving} onClick={submit}>
            {saving ? (
              <InlineLoading description="Saving…" />
            ) : editingUuid ? (
              "Save changes"
            ) : (
              "Create router"
            )}
          </Button>
          {editingUuid && (
            <Button kind="ghost" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </div>
      </Column>

      {/* ---------- existing routers ---------- */}
      <Column sm={4} md={8} lg={16}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <h4>Existing model routers</h4>
          <Button kind="ghost" size="sm" onClick={loadRemote}>
            Refresh
          </Button>
          {loadingRemote && <InlineLoading description="Loading…" />}
        </div>
      </Column>

      <Column sm={4} md={8} lg={16}>
        {remoteError && (
          <InlineNotification
            lowContrast
            kind="error"
            title="Could not load routers"
            subtitle={remoteError}
            style={{ marginBottom: "1rem" }}
          />
        )}
        <Accordion align="start">
          {remote.map((r) => (
            <AccordionItem
              key={r.uuid}
              title={
                <span>
                  {r.name}{" "}
                  {r.description ? <span className="sf-muted">— {r.description}</span> : null}
                </span>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div className="sf-muted" style={{ fontSize: "0.85rem" }}>
                  uuid: {r.uuid}
                  {r.regions?.length ? ` · regions: ${r.regions.join(", ")}` : ""}
                </div>

                <div>
                  <strong>Fallback models</strong>
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                    {(r.config?.fallback_models ?? []).map((m) => (
                      <Tag key={m} type="cool-gray">
                        {m}
                      </Tag>
                    ))}
                    {(r.config?.fallback_models ?? []).length === 0 && (
                      <span className="sf-muted">none</span>
                    )}
                  </div>
                </div>

                <div>
                  <strong>Policies</strong>
                  {(r.config?.policies ?? []).length === 0 && (
                    <div className="sf-muted">none</div>
                  )}
                  {(r.config?.policies ?? []).map((p, i) => (
                    <div
                      key={i}
                      style={{
                        borderLeft: "2px solid var(--cds-border-subtle)",
                        paddingLeft: "0.75rem",
                        margin: "0.4rem 0",
                      }}
                    >
                      <div>
                        <Tag type="blue">{p.task_slug ?? p.custom_task?.name ?? "task"}</Tag>{" "}
                        <span className="sf-muted">
                          prefer: {p.selection_policy?.prefer ?? "none"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                        {(p.models ?? []).map((m) => (
                          <Tag key={m} type="teal">
                            {m}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button size="sm" kind="secondary" onClick={() => startEdit(r)}>
                    Edit
                  </Button>
                  <Button size="sm" kind="danger" onClick={() => remove(r.uuid, r.name)}>
                    Delete
                  </Button>
                </div>
              </div>
            </AccordionItem>
          ))}
        </Accordion>
        {!loadingRemote && !remoteError && remote.length === 0 && (
          <p className="sf-muted">
            No model routers found in your DigitalOcean account yet. Create one above.
          </p>
        )}
      </Column>

      {/* ---------- offline advisor ---------- */}
      <Column sm={4} md={8} lg={16}>
        <hr style={{ margin: "2rem 0 1.5rem", border: "none", borderTop: "1px solid var(--cds-border-subtle)" }} />
        <h4>Offline routing advisor</h4>
        <p className="sf-muted">
          Local what-if rules used for cost/latency planning against recent telemetry.
          These do not change your live DigitalOcean routers.
        </p>
      </Column>

      <Column sm={4} md={8} lg={8}>
        <TextInput
          id="rule-name"
          labelText="Rule name"
          placeholder="e.g. complex reasoning"
          value={ruleName}
          onChange={(e: any) => setRuleName(e.target.value)}
          style={{ marginBottom: "1rem" }}
        />
        <Dropdown
          id="rule-model"
          titleText="Target model"
          label="select model"
          items={models}
          selectedItem={ruleModel}
          onChange={({ selectedItem }: any) => setRuleModel(selectedItem ?? "")}
          style={{ marginBottom: "1rem" }}
        />
        <Button
          kind="primary"
          disabled={busy || !ruleName || !ruleModel}
          onClick={async () => {
            setBusy(true);
            await api
              .post("/router/rules", {
                rule_name: ruleName,
                target_model: ruleModel,
                priority_metric: "Cost",
              })
              .catch(() => {});
            setRuleName("");
            await loadLocal();
            setBusy(false);
          }}
        >
          {busy ? <InlineLoading /> : "Add rule"}
        </Button>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <Accordion align="start">
          {rules.map((r) => (
            <AccordionItem key={r.id} title={r.rule_name}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div className="sf-muted">
                  → {r.target_model} · {r.priority_metric}-biased
                </div>
                <Slider
                  ariaLabelInput="cost weight"
                  labelText={`Cost ⇄ Latency weight: ${r.cost_weight}`}
                  min={0}
                  max={100}
                  value={r.cost_weight}
                  onChange={({ value }: any) =>
                    api.patch(`/router/rules/${r.id}`, { cost_weight: value })
                  }
                />
                <Toggle
                  id={`act-${r.id}`}
                  labelText="Active"
                  toggled={r.is_active === 1}
                  onToggle={(on: boolean) =>
                    api.patch(`/router/rules/${r.id}`, { is_active: on ? 1 : 0 }).then(loadLocal)
                  }
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button
                    size="sm"
                    kind="ghost"
                    onClick={async () => {
                      await api.post(`/router/rules/${r.id}/move`, { dir: -1 });
                      loadLocal();
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    kind="ghost"
                    onClick={async () => {
                      await api.post(`/router/rules/${r.id}/move`, { dir: 1 });
                      loadLocal();
                    }}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    kind="danger"
                    onClick={async () => {
                      await api.delete(`/router/rules/${r.id}`);
                      loadLocal();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </AccordionItem>
          ))}
        </Accordion>
        {rules.length === 0 && <p className="sf-muted">No advisor rules yet.</p>}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
          <Button
            kind="secondary"
            size="sm"
            onClick={async () => {
              await api.post("/router/snapshots", { label: `manual ${new Date().toLocaleString()}` });
              loadLocal();
            }}
          >
            Save snapshot
          </Button>
          <span className="sf-muted">rollback:</span>
          {snapshots.slice(0, 5).map((s: any) => (
            <Button
              key={s.id}
              kind="tertiary"
              size="sm"
              onClick={async () => {
                await api.post(`/router/snapshots/${s.id}/rollback`);
                loadLocal();
              }}
            >
              {new Date(s.ts).toLocaleTimeString()}
            </Button>
          ))}
        </div>
      </Column>
    </Grid>
  );
}
