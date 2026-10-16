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
  ProgressBar,
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

  // ---- budgets (MONITORING.md Phase 6) ----
  const [budgets, setBudgets] = useState<
    Array<{
      id: string;
      name: string;
      scope: string;
      amount_usd: number;
      alerts: number[];
      channels: string[];
      is_active: boolean;
      spend_usd: number;
      pct: number;
      projected_eom_usd: number;
      on_pace_to_exceed: boolean;
      fired: number[];
    }>
  >([]);
  const [bName, setBName] = useState("");
  const [bScope, setBScope] = useState("ai");
  const [bAmount, setBAmount] = useState(50);
  const [bAlerts, setBAlerts] = useState("50,80,100");
  const [editingBudget, setEditingBudget] = useState<string | null>(null);

  // ---- digest (MONITORING.md Phase 7) ----
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestFreq, setDigestFreq] = useState("weekly");
  const [digestNextDue, setDigestNextDue] = useState<string | null>(null);
  const FREQ_LABELS: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    bimonthly: "Every 2 months",
  };

  // ---- backups ----
  const [backups, setBackups] = useState<Array<{ file: string; bytes: number; created_at: string }>>([]);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);

  // ---- backup schedule + S3 ----
  const [schedEnabled, setSchedEnabled] = useState(true);
  const [schedFreq, setSchedFreq] = useState("daily");
  const [schedHour, setSchedHour] = useState(3);
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3Prefix, setS3Prefix] = useState("sailfish/");
  const [s3PathStyle, setS3PathStyle] = useState(false);
  const [s3Access, setS3Access] = useState("");
  const [s3Secret, setS3Secret] = useState("");
  const [s3HasKeys, setS3HasKeys] = useState(false);
  const [s3Objects, setS3Objects] = useState<Array<{ key: string; bytes: number; modified: string }>>([]);
  const [s3Status, setS3Status] = useState<string | null>(null);

  const loadBackups = () =>
    Promise.all([
      api.get<{
        backups: Array<{ file: string; bytes: number; created_at: string }>;
        pending: string | null;
      }>("/backups"),
      api.get<{
        schedule: { enabled: boolean; frequency: string; hour_utc: number };
        s3: {
          endpoint: string;
          bucket: string;
          region: string;
          prefix: string;
          path_style: boolean;
          has_keys: boolean;
        };
      }>("/backups/config"),
    ])
      .then(([b, c]) => {
        setBackups(b.backups);
        setPendingRestore(b.pending);
        setSchedEnabled(c.schedule.enabled);
        setSchedFreq(c.schedule.frequency);
        setSchedHour(c.schedule.hour_utc);
        setS3Endpoint(c.s3.endpoint);
        setS3Bucket(c.s3.bucket);
        setS3Region(c.s3.region);
        setS3Prefix(c.s3.prefix);
        setS3PathStyle(c.s3.path_style);
        setS3HasKeys(c.s3.has_keys);
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
      api.get<{ authenticated: boolean; email?: string }>("/setup/me"),      api.get<{
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
      api.get<{ budgets: any[] }>("/notifications/budgets"),
      api.get<{ enabled: boolean; frequency: string; next_due: string | null }>(
        "/notifications/digest"
      ),
    ])
      .then(([l, t, me, smtp, st, credit, bg, dg]) => {
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
        setBudgets(bg.budgets);
        setDigestEnabled(dg.enabled);
        setDigestFreq(dg.frequency);
        setDigestNextDue(dg.next_due);
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
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>Monthly budgets</h5>
        <p className="sf-muted" style={{ marginBottom: "1rem" }}>
          Monthly envelopes with progressive alerts. Alert levels are yours to define
          (comma-separated percentages, e.g. 50,80,100 — above 100 catches over-budget
          drift). Each level notifies once per month; editing levels never refires
          what already fired.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <TextInput
            id="b-name"
            labelText="Name"
            placeholder="AI inference"
            value={bName}
            onChange={(e: any) => setBName(e.target.value)}
          />
          <Dropdown
            id="b-scope"
            titleText="Scope"
            label="scope"
            items={["ai", "core", "total"]}
            selectedItem={bScope}
            onChange={({ selectedItem }: any) => setBScope(selectedItem)}
          />
          <NumberInput
            id="b-amount"
            label="Monthly cap ($)"
            min={0}
            value={bAmount}
            onChange={(e: any) => setBAmount(Number(e.target.value))}
          />
          <TextInput
            id="b-alerts"
            labelText="Alert levels (%)"
            placeholder="50,80,100"
            value={bAlerts}
            onChange={(e: any) => setBAlerts(e.target.value)}
          />
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (editingBudget) {
                  await api.put(`/notifications/budgets/${editingBudget}`, {
                    amount_usd: bAmount,
                    alerts: bAlerts,
                  });
                  setEditingBudget(null);
                  setNotice({ kind: "success", text: "Budget updated." });
                } else {
                  if (!bName.trim()) throw new Error("Name is required.");
                  await api.post("/notifications/budgets", {
                    name: bName.trim(),
                    scope: bScope,
                    amount_usd: bAmount,
                    alerts: bAlerts,
                  });
                  setNotice({ kind: "success", text: "Budget created." });
                }
                setBName("");
                setBAlerts("50,80,100");
                load();
              })
            }
          >
            {busy ? <InlineLoading /> : editingBudget ? "Update budget" : "Create budget"}
          </Button>
          {editingBudget && (
            <Button
              kind="ghost"
              disabled={busy}
              onClick={() => {
                setEditingBudget(null);
                setBName("");
                setBAlerts("50,80,100");
              }}
            >
              Cancel edit
            </Button>
          )}
        </div>
        <StructuredListWrapper>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>Budget</StructuredListCell>
              <StructuredListCell head>Spent</StructuredListCell>
              <StructuredListCell head>Progress</StructuredListCell>
              <StructuredListCell head>Pace</StructuredListCell>
              <StructuredListCell head>Actions</StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {budgets.map((b) => (
              <StructuredListRow key={b.id}>
                <StructuredListCell>
                  {b.name} <span className="sf-muted">({b.scope}, ${b.amount_usd})</span>
                  {!b.is_active && <Tag type="cool-gray">paused</Tag>}
                </StructuredListCell>
                <StructuredListCell>
                  ${b.spend_usd.toFixed(2)} ({b.pct.toFixed(0)}%)
                </StructuredListCell>
                <StructuredListCell>
                  <ProgressBar
                    label=""
                    hideLabel
                    value={Math.min(b.pct, 100)}
                    max={100}
                    status={b.pct >= 100 ? "error" : "active"}
                  />
                </StructuredListCell>
                <StructuredListCell>
                  {b.on_pace_to_exceed ? (
                    <Tag type="red">over pace (${b.projected_eom_usd.toFixed(0)} EOM)</Tag>
                  ) : (
                    <span className="sf-muted">on pace (${b.projected_eom_usd.toFixed(0)} EOM)</span>
                  )}
                </StructuredListCell>
                <StructuredListCell>
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() => {
                        setEditingBudget(b.id);
                        setBName(b.name);
                        setBScope(b.scope);
                        setBAmount(b.amount_usd);
                        setBAlerts(b.alerts.join(","));
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      kind="danger--ghost"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Delete budget “${b.name}”?`)) return;
                        run(async () => {
                          await api.delete(`/notifications/budgets/${b.id}`);
                          setNotice({ kind: "success", text: "Budget deleted." });
                          load();
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
        {budgets.length === 0 && (
          <p className="sf-muted">No budgets yet — create one above.</p>
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>Digest email</h5>
        <p className="sf-muted" style={{ marginBottom: "1rem" }}>
          Periodic summary (spend, top model, forecast, cache, anomalies, credit) to
          your admin email. Requires SMTP notifications above.
          {digestNextDue ? ` Next due: ${digestNextDue}.` : ""}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <Checkbox
            id="digest-enabled"
            labelText="Enabled"
            checked={digestEnabled}
            onChange={(v: any) => setDigestEnabled(typeof v === "boolean" ? v : v.target.checked)}
          />
          <Dropdown
            id="digest-freq"
            titleText="Cadence"
            label="cadence"
            items={["daily", "weekly", "biweekly", "bimonthly"]}
            itemToString={(f: string) => FREQ_LABELS[f] ?? f}
            selectedItem={digestFreq}
            onChange={({ selectedItem }: any) => setDigestFreq(selectedItem)}
          />
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.post<{ ok: boolean; next_due: string | null }>(
                  "/notifications/digest",
                  { enabled: digestEnabled, frequency: digestFreq }
                );
                setDigestNextDue(r.next_due);
                setNotice({ kind: "success", text: "Digest settings saved." });
              })
            }
          >
            {busy ? <InlineLoading /> : "Save digest"}
          </Button>
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.post<{ ok: boolean; detail: string }>(
                  "/notifications/digest/test"
                );
                setNotice({
                  kind: r.ok ? "success" : "error",
                  text: r.ok ? "Test digest sent." : `Test failed: ${r.detail}`,
                });
              })
            }
          >
            {busy ? <InlineLoading /> : "Send test digest"}
          </Button>
        </div>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>Backups</h5>
        <p className="sf-muted" style={{ marginBottom: "1rem" }}>
          Automatic snapshots on your schedule — newest 7 kept locally, plus S3
          off-host copies when configured. Restoring stages the file and needs an
          app restart to take effect; a safety snapshot is taken first.
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end", marginBottom: "0.75rem" }}>
          <Checkbox
            id="sched-enabled"
            labelText="Scheduled backups"
            checked={schedEnabled}
            onChange={(v: any) => setSchedEnabled(typeof v === "boolean" ? v : v.target.checked)}
          />
          <Dropdown
            id="sched-freq"
            titleText="Frequency"
            label="frequency"
            items={["daily", "weekly"]}
            selectedItem={schedFreq}
            onChange={({ selectedItem }: any) => setSchedFreq(selectedItem)}
          />
          <NumberInput
            id="sched-hour"
            label="Hour (UTC)"
            min={0}
            max={23}
            value={schedHour}
            onChange={(e: any) => setSchedHour(Number(e.target.value))}
          />
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post("/backups/config", {
                  enabled: schedEnabled,
                  frequency: schedFreq,
                  hour_utc: schedHour,
                });
                setNotice({ kind: "success", text: "Backup schedule saved." });
              })
            }
          >
            {busy ? <InlineLoading /> : "Save schedule"}
          </Button>
        </div>
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

        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>S3 off-host copies</h5>
        <p className="sf-muted" style={{ marginBottom: "1rem" }}>
          Works with DO Spaces, AWS S3, R2, MinIO, Wasabi. Keys stay in the vault
          (blank = keep current{s3HasKeys ? " — keys stored" : ""}).
          {s3Status ? ` Last check: ${s3Status}.` : ""}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <TextInput id="s3-endpoint" labelText="Endpoint (https://…)" value={s3Endpoint}
            onChange={(e: any) => setS3Endpoint(e.target.value)} />
          <TextInput id="s3-bucket" labelText="Bucket" value={s3Bucket}
            onChange={(e: any) => setS3Bucket(e.target.value)} />
          <TextInput id="s3-region" labelText="Region" value={s3Region}
            onChange={(e: any) => setS3Region(e.target.value)} />
          <TextInput id="s3-prefix" labelText="Prefix" value={s3Prefix}
            onChange={(e: any) => setS3Prefix(e.target.value)} />
          <TextInput id="s3-access" labelText="Access key" value={s3Access}
            onChange={(e: any) => setS3Access(e.target.value)} />
          <PasswordInput id="s3-secret" labelText="Secret key (blank = keep)"
            value={s3Secret} onChange={(e: any) => setS3Secret(e.target.value)} />
          <Checkbox id="s3-pathstyle" labelText="Path-style (MinIO)" checked={s3PathStyle}
            onChange={(v: any) => setS3PathStyle(typeof v === "boolean" ? v : v.target.checked)} />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <Button
            kind="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post("/backups/config", {
                  s3: {
                    endpoint: s3Endpoint, bucket: s3Bucket, region: s3Region,
                    prefix: s3Prefix, path_style: s3PathStyle,
                    ...(s3Access ? { access_key: s3Access } : {}),
                    ...(s3Secret ? { secret_key: s3Secret } : {}),
                  },
                });
                setS3Access("");
                setS3Secret("");
                setNotice({ kind: "success", text: "S3 settings saved." });
                loadBackups();
              })
            }
          >
            {busy ? <InlineLoading /> : "Save S3"}
          </Button>
          <Button
            kind="ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.post<{ ok: boolean; detail: string }>("/backups/s3/test");
                setS3Status(r.ok ? "reachable, write ok" : `failed: ${r.detail}`);
                setNotice({
                  kind: r.ok ? "success" : "error",
                  text: r.ok ? "S3 reachable, write ok." : `S3 test failed: ${r.detail}`,
                });
              })
            }
          >
            {busy ? <InlineLoading /> : "Test S3"}
          </Button>
          <Button
            kind="ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.get<{ objects: Array<{ key: string; bytes: number; modified: string }> }>(
                  "/backups/s3"
                );
                setS3Objects(r.objects);
                if (!r.objects.length)
                  setNotice({ kind: "success", text: "Connected — no objects under that prefix." });
              })
            }
          >
            {busy ? <InlineLoading /> : "List S3 objects"}
          </Button>
        </div>
        {s3Objects.length > 0 && (
          <StructuredListWrapper>
            <StructuredListHead>
              <StructuredListRow head>
                <StructuredListCell head>Object</StructuredListCell>
                <StructuredListCell head>Size</StructuredListCell>
                <StructuredListCell head>Actions</StructuredListCell>
              </StructuredListRow>
            </StructuredListHead>
            <StructuredListBody>
              {s3Objects.map((o) => (
                <StructuredListRow key={o.key}>
                  <StructuredListCell>{o.key}</StructuredListCell>
                  <StructuredListCell>{(o.bytes / 1024).toFixed(1)} KB</StructuredListCell>
                  <StructuredListCell>
                    <Button
                      size="sm"
                      kind="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = await api.post<{ ok: boolean; file: string }>(
                            "/backups/s3/fetch",
                            { key: o.key }
                          );
                          setNotice({
                            kind: "success",
                            text: `Fetched as ${r.file} — restore it from the list above.`,
                          });
                          loadBackups();
                        })
                      }
                    >
                      Fetch to local
                    </Button>
                  </StructuredListCell>
                </StructuredListRow>
              ))}
            </StructuredListBody>
          </StructuredListWrapper>
        )}
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
