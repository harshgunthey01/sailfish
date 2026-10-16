import React, { useEffect, useState } from "react";
import {
  Grid,
  Column,
  StructuredListWrapper,
  StructuredListHead,
  StructuredListRow,
  StructuredListCell,
  StructuredListBody,
  Toggle,
  Tag,
  Button,
  Modal,
  CodeSnippet,
  InlineLoading,
  InlineNotification,
  TextInput,
  Search,
} from "@carbon/react";
import { api } from "../api";

interface Managed {
  id: string;
  model_name: string;
  status: string;
}
interface AvailableModel {
  id?: string;
  name?: string;
  provider?: string;
  type?: string;
}
interface Job {
  id: string;
  type: string;
  status: string;
  stdout: string | null;
  stderr: string | null;
  payload_json: string;
}
interface ModelRate {
  model_key: string;
  input_per_1m: number;
  output_per_1m: number;
  observed_at: string;
}

const PAGE_SIZE = 100;

export default function ModelsPage() {
  const [managed, setManaged] = useState<Managed[]>([]);
  const [available, setAvailable] = useState<AvailableModel[]>([]);
  const [source, setSource] = useState("cache");
  const [rates, setRates] = useState<ModelRate[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [output, setOutput] = useState<string | null>(null);
  const [newModel, setNewModel] = useState("");
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = () =>
    Promise.all([
      api.get<{ managed: Managed[]; available: AvailableModel[]; source?: string; rates?: ModelRate[] }>("/models"),
      api.get<{ jobs: Job[] }>("/models/jobs"),
    ])
      .then(([m, j]) => {
        setManaged(m.managed);
        setAvailable(m.available as AvailableModel[]);
        setSource(m.source ?? "cache");
        setRates(m.rates ?? []);
      })
      .catch((e: any) =>
        setNotice({ kind: "error", text: e?.body?.error ?? e?.message ?? "Failed to load models" })
      );

  // Poll fast only while a provisioning job is in flight; idle otherwise.
  const anyDeploying = managed.some((m) => m.status === "Deploying");
  useEffect(() => {
    load();
    const h = setInterval(load, anyDeploying ? 10_000 : 60_000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyDeploying]);

  const rateFor = (name: string) =>
    rates.find((r) => r.model_key.toLowerCase() === name.toLowerCase());
  const cheapest = rates.length
    ? rates.reduce((a, b) => (a.input_per_1m <= b.input_per_1m ? a : b))
    : null;

  const lastJobFor = (name: string) =>
    jobs.find((j) => {
      try {
        return JSON.parse(j.payload_json).model_name === name;
      } catch {
        return false;
      }
    });

  const addModel = async (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    try {
      await api.post("/models", { model_name: name });
      setNewModel("");
      setNotice({ kind: "success", text: `Provisioning started for “${name}”.` });
      load();
    } catch (e: any) {
      setNotice({ kind: "error", text: e?.body?.error ?? e?.message ?? "Add failed" });
    }
  };

  const toggleModel = async (name: string, on: boolean) => {
    try {
      if (on) await api.post("/models", { model_name: name });
      else await api.delete(`/models/${encodeURIComponent(name)}`);
      load();
      setTimeout(load, 1500);
    } catch (e: any) {
      setNotice({ kind: "error", text: e?.body?.error ?? e?.message ?? "Update failed" });
    }
  };

  const retireModel = async (name: string) => {
    if (!window.confirm(`Retire “${name}” from the fleet? It will be removed entirely.`)) return;
    try {
      await api.delete(`/models/${encodeURIComponent(name)}/retire`);
      setNotice({ kind: "success", text: `Retired “${name}”.` });
      load();
    } catch (e: any) {
      setNotice({ kind: "error", text: e?.body?.error ?? e?.message ?? "Retire failed" });
    }
  };

  const managedNames = new Set(managed.map((m) => m.model_name.toLowerCase()));
  const visibleAvailable = available
    .map((a) => String(a.id ?? a.name ?? ""))
    .filter(Boolean)
    .filter((n) => !managedNames.has(n.toLowerCase()))
    .filter((n) => !filter || n.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, PAGE_SIZE);

  return (
    <Grid narrow className="sf-content">
      <Column sm={4} md={8} lg={16}>
        <h3>Model Registry</h3>
        {cheapest && (
          <p className="sf-muted" style={{ marginBottom: "0.5rem" }}>
            Cheapest observed input: <strong>{cheapest.model_key}</strong> @ $
            {cheapest.input_per_1m}/1M tokens (from your bills)
          </p>
        )}
        {notice && (
          <InlineNotification
            kind={notice.kind}
            title={notice.kind === "error" ? "Error" : "OK"}
            subtitle={notice.text}
            lowContrast
            onCloseButtonClick={() => setNotice(null)}
            style={{ margin: "0.5rem 0" }}
          />
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <TextInput
            id="new-model"
            labelText="Add model by name"
            placeholder="e.g. llama3.3-70b-instruct"
            value={newModel}
            onChange={(e: any) => setNewModel(e.target.value)}
            hideLabel
          />
          <Button kind="primary" onClick={() => addModel(newModel)}>
            Add
          </Button>
        </div>

        <StructuredListWrapper>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>Model</StructuredListCell>
              <StructuredListCell head>Status</StructuredListCell>
              <StructuredListCell head>$/1M in·out</StructuredListCell>
              <StructuredListCell head>Active</StructuredListCell>
              <StructuredListCell head>Actions</StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {managed.map((m) => {
              const job = lastJobFor(m.model_name);
              const provisioning = m.status === "Deploying";
              const rate = rateFor(m.model_name);
              return (
                <StructuredListRow key={m.id}>
                  <StructuredListCell>{m.model_name}</StructuredListCell>
                  <StructuredListCell>
                    {provisioning ? (
                      <InlineLoading description="provisioning…" />
                    ) : (
                      <Tag type={m.status === "Active" ? "green" : "gray"}>{m.status}</Tag>
                    )}
                  </StructuredListCell>
                  <StructuredListCell>
                    {rate ? (
                      <span>
                        ${rate.input_per_1m}·${rate.output_per_1m}{" "}
                        {cheapest && rate.model_key === cheapest.model_key && (
                          <Tag type="green">cheapest</Tag>
                        )}
                      </span>
                    ) : (
                      <span className="sf-muted">—</span>
                    )}
                  </StructuredListCell>
                  <StructuredListCell>
                    <Toggle
                      id={`tgl-${m.id}`}
                      labelText=""
                      hideLabel
                      toggled={m.status === "Active"}
                      onToggle={(on: boolean) => toggleModel(m.model_name, on)}
                    />
                  </StructuredListCell>
                  <StructuredListCell>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      <Button
                        size="sm"
                        kind="ghost"
                        onClick={() =>
                          setOutput(
                            `$ job ${job?.type ?? "-"}\n--- stdout ---\n${job?.stdout ?? "(none)"}\n--- stderr ---\n${job?.stderr ?? "(none)"}`
                          )
                        }
                      >
                        logs
                      </Button>
                      <Button size="sm" kind="danger--ghost" onClick={() => retireModel(m.model_name)}>
                        Retire
                      </Button>
                    </div>
                  </StructuredListCell>
                </StructuredListRow>
              );
            })}
          </StructuredListBody>
        </StructuredListWrapper>
        {managed.length === 0 && (
          <p className="sf-muted">No managed models yet — add one above or from the list below.</p>
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>
          Available on DigitalOcean{" "}
          <Tag type={source === "live" ? "green" : "cool-gray"}>{source}</Tag>
        </h5>
        <Search
          id="model-search"
          labelText="Filter available models"
          placeholder="e.g. deepseek, glm, qwen…"
          value={filter}
          onChange={(e: any) => setFilter(e.target.value)}
          style={{ marginBottom: "0.75rem" }}
        />
        <StructuredListWrapper>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>Model</StructuredListCell>
              <StructuredListCell head>Actions</StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {visibleAvailable.map((n) => (
              <StructuredListRow key={n}>
                <StructuredListCell>{n}</StructuredListCell>
                <StructuredListCell>
                  <Button size="sm" kind="secondary" onClick={() => addModel(n)}>
                    Add
                  </Button>
                </StructuredListCell>
              </StructuredListRow>
            ))}
          </StructuredListBody>
        </StructuredListWrapper>
        {visibleAvailable.length === 0 && (
          <p className="sf-muted">
            {available.length === 0
              ? "Could not reach the DO model list — check Settings → DigitalOcean connection."
              : "No matches (models already in your fleet are hidden)."}
          </p>
        )}
        {visibleAvailable.length >= PAGE_SIZE && (
          <p className="sf-muted">Showing first {PAGE_SIZE} — refine the filter to narrow down.</p>
        )}
      </Column>

      <Modal
        open={output !== null}
        modalHeading="Terminal output"
        passiveModal
        onRequestClose={() => setOutput(null)}
        className="sf-error-modal"
      >
        <CodeSnippet type="multi" hideCopyButton>
          {output ?? ""}
        </CodeSnippet>
      </Modal>
    </Grid>
  );
}
