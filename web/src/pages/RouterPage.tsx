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
  Button,
  InlineLoading,
} from "@carbon/react";
import { api } from "../api";

interface Rule {
  id: string;
  rule_name: string;
  target_model: string;
  priority_metric: "Cost" | "Latency";
  is_active: number;
  position: number;
  cost_weight: number;
}

export default function RouterPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
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
        setModels(Array.from(names));
        setSnapshots(s.snapshots as any[]);
      })
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  return (
    <Grid narrow className="sf-content">
      <Column sm={4} md={8} lg={16}>
        <h3>Inference Router</h3>
        <p className="sf-muted">
          Order rules, pick target models, and slide between cost-optimization and
          latency-optimization per rule.
        </p>
      </Column>

      <Column sm={4} md={8} lg={8}>
        <TextInput
          id="rule-name"
          labelText="Rule name"
          placeholder="e.g. complex reasoning"
          value={name}
          onChange={(e: any) => setName(e.target.value)}
          style={{ marginBottom: "1rem" }}
        />
        <Dropdown
          id="rule-model"
          titleText="Target model"
          label="select model"
          items={models}
          selectedItem={model}
          onChange={({ selectedItem }: any) => setModel(selectedItem ?? "")}
          style={{ marginBottom: "1rem" }}
        />
        <Button
          kind="primary"
          disabled={busy || !name || !model}
          onClick={async () => {
            setBusy(true);
            await api.post("/router/rules", {
              rule_name: name,
              target_model: model,
              priority_metric: "Cost",
            }).catch(() => {});
            setName("");
            await load();
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
                    api.patch(`/router/rules/${r.id}`, { is_active: on ? 1 : 0 }).then(load)
                  }
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button size="sm" kind="ghost" onClick={async () => {
                    await api.post(`/router/rules/${r.id}/move`, { dir: -1 });
                    load();
                  }}>↑</Button>
                  <Button size="sm" kind="ghost" onClick={async () => {
                    await api.post(`/router/rules/${r.id}/move`, { dir: 1 });
                    load();
                  }}>↓</Button>
                  <Button size="sm" kind="danger" onClick={async () => {
                    await api.delete(`/router/rules/${r.id}`);
                    load();
                  }}>Delete</Button>
                </div>
              </div>
            </AccordionItem>
          ))}
        </Accordion>
        {rules.length === 0 && <p className="sf-muted">No rules yet.</p>}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
          <Button kind="secondary" size="sm" onClick={async () => {
            await api.post("/router/snapshots", { label: `manual ${new Date().toLocaleString()}` });
            load();
          }}>
            Save snapshot
          </Button>
          <span className="sf-muted">rollback:</span>
          {snapshots.slice(0, 5).map((s: any) => (
            <Button key={s.id} kind="tertiary" size="sm" onClick={async () => {
              await api.post(`/router/snapshots/${s.id}/rollback`);
              load();
            }}>
              {new Date(s.ts).toLocaleTimeString()}
            </Button>
          ))}
        </div>
      </Column>
    </Grid>
  );
}
