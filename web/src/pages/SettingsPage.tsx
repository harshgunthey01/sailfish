import React, { useEffect, useState } from "react";
import {
  Grid,
  Column,
  TextInput,
  NumberInput,
  Button,
  InlineNotification,
  StructuredListWrapper,
  StructuredListHead,
  StructuredListRow,
  StructuredListCell,
  StructuredListBody,
  Tag,
  Dropdown,
  Checkbox,
} from "@carbon/react";
import { api } from "../api";

interface Threshold {
  id: string;
  name: string;
  metric: string;
  operator: string;
  value: number;
  channels_json: string;
  last_triggered_at: string | null;
}

export default function SettingsPage() {
  const [log, setLog] = useState<any[]>([]);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // new threshold form
  const [tName, setTName] = useState("");
  const [tMetric, setTMetric] = useState("compute_balance");
  const [tOp, setTOp] = useState("gt");
  const [tValue, setTValue] = useState(25);
  const [chSmtp, setChSmtp] = useState(true);
  const [chSlack, setChSlack] = useState(false);
  const [chGchat, setChGchat] = useState(false);

  const load = () =>
    Promise.all([
      api.get<{ log: any[] }>("/notifications/log"),
      api.get<{ thresholds: Threshold[] }>("/notifications/thresholds"),
    ])
      .then(([l, t]) => {
        setLog(l.log as any[]);
        setThresholds(t.thresholds as Threshold[]);
      })
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  return (
    <Grid narrow className="sf-content">
      <Column sm={4} md={8} lg={16}>
        <h3>Alerts & Notification Log</h3>
        {notice && (
          <InlineNotification
            kind={notice.kind}
            title={notice.kind === "error" ? "Error" : "OK"}
            subtitle={notice.text}
            lowContrast
            style={{ margin: "0.5rem 0" }}
          />
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5>New billing threshold</h5>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <TextInput
            id="t-name"
            labelText="Name"
            value={tName}
            onChange={(e: any) => setTName(e.target.value)}
          />
          <Dropdown
            id="t-metric"
            titleText="Metric"
            label="metric"
            items={["compute_balance", "inference_balance", "inference_remaining_pct"]}
            selectedItem={tMetric}
            onChange={({ selectedItem }: any) => setTMetric(selectedItem)}
          />
          <Dropdown
            id="t-op"
            titleText="Operator"
            label="op"
            items={["gt", "lt"]}
            selectedItem={tOp}
            onChange={({ selectedItem }: any) => setTOp(selectedItem)}
          />
          <NumberInput
            id="t-value"
            label="Value ($ or %)"
            value={tValue}
            onChange={(e: any) => setTValue(Number(e.target.value))}
          />
          <Checkbox id="ch-smtp" labelText="Email" checked={chSmtp} onChange={(v: any) => setChSmtp(typeof v === "boolean" ? v : v.target.checked)} />
          <Checkbox id="ch-slack" labelText="Slack" checked={chSlack} onChange={(v: any) => setChSlack(typeof v === "boolean" ? v : v.target.checked)} />
          <Checkbox id="ch-gchat" labelText="GChat" checked={chGchat} onChange={(v: any) => setChGchat(typeof v === "boolean" ? v : v.target.checked)} />
          <Button
            kind="primary"
            onClick={async () => {
              try {
                await api.post("/setup/thresholds", {
                  name: tName || "threshold",
                  metric: tMetric,
                  operator: tOp,
                  value: tValue,
                  channels: [
                    ...(chSmtp ? ["smtp"] : []),
                    ...(chSlack ? ["slack"] : []),
                    ...(chGchat ? ["gchat"] : []),
                  ],
                });
                setNotice({ kind: "success", text: "threshold saved" });
                load();
              } catch (e: any) {
                setNotice({ kind: "error", text: e?.message ?? String(e) });
              }
            }}
          >
            Save threshold
          </Button>
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          <h5>Notification log</h5>
          <StructuredListWrapper>
            <StructuredListHead>
              <StructuredListRow head>
                <StructuredListCell head>When</StructuredListCell>
                <StructuredListCell head>Channel</StructuredListCell>
                <StructuredListCell head>Event</StructuredListCell>
                <StructuredListCell head>Status</StructuredListCell>
                <StructuredListCell head>Detail</StructuredListCell>
              </StructuredListRow>
            </StructuredListHead>
            <StructuredListBody>
              {log.map((r: any) => (
                <StructuredListRow key={r.id}>
                  <StructuredListCell>{new Date(r.ts + "Z").toLocaleString()}</StructuredListCell>
                  <StructuredListCell>{r.channel}</StructuredListCell>
                  <StructuredListCell>{r.event}</StructuredListCell>
                  <StructuredListCell>
                    <Tag type={r.status === "sent" ? "green" : "red"}>{r.status}</Tag>
                  </StructuredListCell>
                  <StructuredListCell>{r.detail}</StructuredListCell>
                </StructuredListRow>
              ))}
            </StructuredListBody>
          </StructuredListWrapper>
          {log.length === 0 && <p className="sf-muted">No notifications sent yet.</p>}
        </div>
      </Column>
    </Grid>
  );
}
