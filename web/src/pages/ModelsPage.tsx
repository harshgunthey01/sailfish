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
  TextInput,
} from "@carbon/react";
import { api } from "../api";

interface Managed {
  id: string;
  model_name: string;
  status: string;
}
interface Job {
  id: string;
  type: string;
  status: string;
  stdout: string | null;
  stderr: string | null;
  payload_json: string;
}

export default function ModelsPage() {
  const [managed, setManaged] = useState<Managed[]>([]);
  const [available, setAvailable] = useState<any[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [output, setOutput] = useState<string | null>(null);
  const [newModel, setNewModel] = useState("");

  const load = () =>
    Promise.all([
      api.get<{ managed: Managed[]; available: any[] }>("/models"),
      api.get<{ jobs: Job[] }>("/models/jobs"),
    ])
      .then(([m, j]) => {
        setManaged(m.managed);
        setAvailable(m.available as any[]);
        setJobs(j.jobs);
      })
      .catch(() => {});

  useEffect(() => {
    load();
    const h = setInterval(load, 10_000);
    return () => clearInterval(h);
  }, []);

  const lastJobFor = (name: string) =>
    jobs.find((j) => JSON.parse(j.payload_json).model_name === name);

  return (
    <Grid narrow className="sf-content">
      <Column sm={4} md={8} lg={16}>
        <h3>Model Registry</h3>
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
          <Button
            kind="primary"
            onClick={async () => {
              if (!newModel) return;
              await api.post("/models", { model_name: newModel }).catch(() => {});
              setNewModel("");
              load();
            }}
          >
            Add
          </Button>
        </div>

        <StructuredListWrapper>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>Model</StructuredListCell>
              <StructuredListCell head>Status</StructuredListCell>
              <StructuredListCell head>Active</StructuredListCell>
              <StructuredListCell head>Actions</StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {managed.map((m) => {
              const job = lastJobFor(m.model_name);
              const provisioning = m.status === "Deploying";
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
                    <Toggle
                      id={`tgl-${m.id}`}
                      labelText=""
                      hideLabel
                      toggled={m.status === "Active"}
                      onToggle={(on: boolean) => {
                        if (on) api.post("/models", { model_name: m.model_name });
                        else api.delete(`/models/${encodeURIComponent(m.model_name)}`);
                        setTimeout(load, 500);
                      }}
                    />
                  </StructuredListCell>
                  <StructuredListCell>
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
                  </StructuredListCell>
                </StructuredListRow>
              );
            })}
          </StructuredListBody>
        </StructuredListWrapper>
        {managed.length === 0 && (
          <p className="sf-muted">
            No managed models yet. {available.length} models available on your DO account.
          </p>
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
