import React, { useEffect, useState } from "react";
import {
  Grid,
  Column,
  TextInput,
  PasswordInput,
  NumberInput,
  Button,
  InlineNotification,
  InlineLoading,
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
  const [busy, setBusy] = useState(false);

  // ---- administrator ----
  const [adminEmail, setAdminEmail] = useState("");
  const [curPass, setCurPass] = useState("");
  const [newPass, setNewPass] = useState("");

  // ---- notifications (mirrors onboarding step 2) ----
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [gchatWebhook, setGchatWebhook] = useState("");

  // ---- DigitalOcean (mirrors onboarding step 3; blank = keep current) ----
  const [doConfigured, setDoConfigured] = useState(false);
  const [doToken, setDoToken] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [doTest, setDoTest] = useState<string | null>(null);

  // ---- AI credit remainder (manual: copied from DO's billing page) ----
  const [creditRemaining, setCreditRemaining] = useState("");
  const [creditAsOf, setCreditAsOf] = useState<string | null>(null);

  // ---- backups ----
  const [backups, setBackups] = useState<Array<{ file: string; bytes: number; created_at: string }>>([]);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);

  const loadBackups = () =>
    api
      .get<{
        backups: Array<{ file: string; bytes: number; created_at: string }>;
        pending: string | null;
      }>("/backups")
      .then((r) => {
        setBackups(r.backups);
        setPendingRestore(r.pending);
      })
      .catch(() => {});

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
      api.get<{ authenticated: boolean; email?: string }>("/setup/me"),
      api.get<{
        configured: boolean;
        host: string;
        port: number;
        username: string;
        from: string;
        has_password: boolean;
        slack_webhook: string;
        gchat_webhook: string;
      }>("/setup/smtp"),
      api.get<{ setup_complete: boolean; smtp_configured: boolean; do_auth_configured: boolean }>(
        "/setup/status"
      ),
      api.get<{ remaining: number | null; as_of: string | null }>("/setup/credit"),
    ])
      .then(([l, t, me, smtp, st, credit]) => {
        setLog(l.log as any[]);
        setThresholds(t.thresholds as Threshold[]);
        if (me.authenticated) setAdminEmail(me.email ?? "");
        setSmtpConfigured(smtp.configured);
        setSmtpHost(smtp.host);
        setSmtpPort(smtp.port);
        setSmtpUser(smtp.username);
        setSmtpFrom(smtp.from);
        setSlackWebhook(smtp.slack_webhook);
        setGchatWebhook(smtp.gchat_webhook);
        setDoConfigured(st.do_auth_configured);
        if (credit.remaining != null) setCreditRemaining(String(credit.remaining));
        setCreditAsOf(credit.as_of);
      })
      .catch(() => {});

  useEffect(() => {
    load();
    loadBackups();
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e: any) {
      setNotice({ kind: "error", text: e?.body?.error ?? e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  };

  const smtpPayload = () => ({
    host: smtpHost,
    port: smtpPort,
    username: smtpUser,
    password: smtpPass || undefined,
    from: smtpFrom,
    slack_webhook: slackWebhook,
    gchat_webhook: gchatWebhook,
  });

  return (
    <Grid narrow className="sf-content">
      <Column sm={4} md={8} lg={16}>
        <h3>Settings</h3>
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

      {/* ---------- administrator (onboarding step 1) ---------- */}
      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "0.5rem 0" }}>Administrator</h5>
        <p className="sf-muted" style={{ marginBottom: "1rem" }}>
          Signed in as <strong>{adminEmail || "…"}</strong>. Change the admin password here —
          the email itself cannot be changed after onboarding.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <PasswordInput
            id="cur-pass"
            labelText="Current password"
            value={curPass}
            onChange={(e: any) => setCurPass(e.target.value)}
          />
          <PasswordInput
            id="new-pass"
            labelText="New password (min 8 chars)"
            value={newPass}
            onChange={(e: any) => setNewPass(e.target.value)}
          />
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post("/setup/password", {
                  current_password: curPass,
                  new_password: newPass,
                });
                setCurPass("");
                setNewPass("");
                setNotice({ kind: "success", text: "Admin password updated." });
              })
            }
          >
            {busy ? <InlineLoading /> : "Change password"}
          </Button>
        </div>
      </Column>

      {/* ---------- notifications (onboarding step 2) ---------- */}
      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>
          Notifications{" "}
          {smtpConfigured ? <Tag type="green">configured</Tag> : <Tag type="cool-gray">not set</Tag>}
        </h5>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <TextInput id="set-smtp-host" labelText="SMTP host" value={smtpHost}
            onChange={(e: any) => setSmtpHost(e.target.value)} />
          <NumberInput id="set-smtp-port" label="SMTP port" value={smtpPort} min={1} max={65535}
            onChange={(e: any) => setSmtpPort(Number(e.target.value))} />
          <TextInput id="set-smtp-user" labelText="SMTP username" value={smtpUser}
            onChange={(e: any) => setSmtpUser(e.target.value)} />
          <PasswordInput id="set-smtp-pass" labelText="SMTP password (blank = keep current)"
            value={smtpPass} onChange={(e: any) => setSmtpPass(e.target.value)} />
          <TextInput id="set-smtp-from" labelText="From address" value={smtpFrom}
            onChange={(e: any) => setSmtpFrom(e.target.value)} />
          <TextInput id="set-slack" labelText="Slack webhook URL (optional)" value={slackWebhook}
            onChange={(e: any) => setSlackWebhook(e.target.value)} />
          <TextInput id="set-gchat" labelText="Google Chat webhook URL (optional)" value={gchatWebhook}
            onChange={(e: any) => setGchatWebhook(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post("/setup/smtp", smtpPayload());
                setSmtpPass("");
                setNotice({ kind: "success", text: "Notification settings saved." });
                load();
              })
            }
          >
            {busy ? <InlineLoading /> : "Save notifications"}
          </Button>
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post("/setup/smtp", smtpPayload());
                const r = await api.post<{ ok: boolean; detail: string }>("/setup/smtp/test");
                setSmtpPass("");
                setNotice({ kind: "success", text: `Test email: ${r.detail}` });
                load();
              })
            }
          >
            {busy ? <InlineLoading /> : "Save & send test email"}
          </Button>
        </div>
      </Column>

      {/* ---------- DigitalOcean (onboarding step 3) ---------- */}
      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>
          DigitalOcean connection{" "}
          {doConfigured ? <Tag type="green">connected</Tag> : <Tag type="red">not connected</Tag>}
        </h5>
        <p className="sf-muted" style={{ marginBottom: "1rem" }}>
          Rotate outdated credentials here. Leave a field blank to keep its current value.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <PasswordInput id="set-do-token" labelText="OAuth token (blank = keep current)"
            value={doToken} onChange={(e: any) => setDoToken(e.target.value)} />
          <PasswordInput id="set-model-key" labelText="Model access key (blank = keep current)"
            value={modelKey} onChange={(e: any) => setModelKey(e.target.value)} />
        </div>
        {doTest && (
          <InlineNotification kind="info" title="Connection test" subtitle={doTest}
            lowContrast style={{ marginTop: "0.75rem" }} />
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!doToken && !modelKey) throw new Error("Enter at least one credential.");
                await api.post("/setup/do", {
                  ...(doToken ? { do_token: doToken } : {}),
                  ...(modelKey ? { model_access_key: modelKey } : {}),
                });
                setDoToken("");
                setModelKey("");
                setNotice({ kind: "success", text: "DigitalOcean credentials updated." });
                load();
              })
            }
          >
            {busy ? <InlineLoading /> : "Save credentials"}
          </Button>
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.post<{
                  ok: boolean;
                  control_plane: { ok: boolean; detail: string };
                  inference: { ok: boolean; detail: string };
                }>("/setup/do/test");
                setDoTest(`control-plane: ${r.control_plane.detail} | inference: ${r.inference.detail}`);
              })
            }
          >
            {busy ? <InlineLoading /> : "Test connection"}
          </Button>
        </div>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>AI credit remaining (manual)</h5>
        <p className="sf-muted" style={{ marginBottom: "1rem" }}>
          DigitalOcean exposes no API for the live AI-credit balance — copy it from
          DO&apos;s billing page. Saved with today&apos;s date.
          {creditAsOf ? ` Currently $${creditRemaining || "—"} as of ${creditAsOf}.` : ""}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <NumberInput
            id="credit-remaining"
            label="Remaining credit ($)"
            value={creditRemaining === "" ? 0 : Number(creditRemaining)}
            min={0}
            onChange={(e: any) => setCreditRemaining(e.target.value)}
          />
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.post<{ ok: boolean; remaining: number; as_of: string }>(
                  "/setup/credit",
                  { remaining: Number(creditRemaining) }
                );
                setCreditRemaining(String(r.remaining));
                setCreditAsOf(r.as_of);
                setNotice({ kind: "success", text: `AI credit saved: $${r.remaining} as of ${r.as_of}.` });
              })
            }
          >
            {busy ? <InlineLoading /> : "Save credit balance"}
          </Button>
        </div>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>Backups</h5>
        <p className="sf-muted" style={{ marginBottom: "1rem" }}>
          Automatic daily backup (03:00) plus one at boot when stale — newest 7 kept.
          Restoring stages the file and needs an app restart to take effect; a safety
          snapshot is taken first.
        </p>
        {pendingRestore && (
          <InlineNotification
            kind="warning"
            title="Restore staged"
            subtitle={`${pendingRestore} will replace the database on next restart. Restart the app to apply, or cancel below.`}
            lowContrast
            style={{ marginBottom: "0.75rem" }}
          />
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.post<{ ok: boolean; backup: { file: string } }>("/backups");
                setNotice({ kind: "success", text: `Backup created: ${r.backup.file}` });
                loadBackups();
              })
            }
          >
            {busy ? <InlineLoading /> : "Back up now"}
          </Button>
          {pendingRestore && (
            <Button
              kind="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.delete("/backups/pending/restore");
                  setNotice({ kind: "success", text: "Staged restore cancelled." });
                  loadBackups();
                })
              }
            >
              Cancel staged restore
            </Button>
          )}
        </div>
        <StructuredListWrapper>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>File</StructuredListCell>
              <StructuredListCell head>Size</StructuredListCell>
              <StructuredListCell head>Actions</StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {backups.map((b) => (
              <StructuredListRow key={b.file}>
                <StructuredListCell>{b.file}</StructuredListCell>
                <StructuredListCell>{(b.bytes / 1024).toFixed(1)} KB</StructuredListCell>
                <StructuredListCell>
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() => {
                        window.open(`/api/v1/backups/${encodeURIComponent(b.file)}/download`, "_blank");
                      }}
                    >
                      Download
                    </Button>
                    <Button
                      size="sm"
                      kind="danger--ghost"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Restore ${b.file}? A safety snapshot is taken first, but the app must be restarted before it takes effect.`
                          )
                        )
                          return;
                        run(async () => {
                          const r = await api.post<{ ok: boolean; safety: string }>(
                            `/backups/${encodeURIComponent(b.file)}/restore`
                          );
                          setNotice({
                            kind: "success",
                            text: `Restore staged (safety: ${r.safety}). Restart the app to apply.`,
                          });
                          loadBackups();
                        });
                      }}
                    >
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      kind="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Delete backup ${b.file}?`)) return;
                        run(async () => {
                          await api.delete(`/backups/${encodeURIComponent(b.file)}`);
                          loadBackups();
                        });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </StructuredListCell>
              </StructuredListRow>
            ))}
          </StructuredListBody>
        </StructuredListWrapper>
        {backups.length === 0 && <p className="sf-muted">No backups yet.</p>}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>New billing threshold</h5>
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
            items={["compute_balance", "inference_balance", "inference_remaining_pct", "daily_spend_usd", "daily_spend_spike"]}
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
            label="Value ($, %, or ×)"
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
