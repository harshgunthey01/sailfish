import React, { useState } from "react";
import {
  ProgressIndicator,
  ProgressStep,
  TextInput,
  PasswordInput,
  Button,
  InlineLoading,
  InlineNotification,
  NumberInput,
  Checkbox,
} from "@carbon/react";
import { api } from "../api";

interface Props {
  needLogin: boolean;
  onDone: () => void;
}

export default function SetupWizard({ needLogin, onDone }: Props) {
  const [step, setStep] = useState(needLogin ? -1 : 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // step 1
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // step 2
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [gchatWebhook, setGchatWebhook] = useState("");

  // step 3
  const [doToken, setDoToken] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e: any) {
      setNotice({ kind: "error", text: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sf-wizard">
      <h2 style={{ marginBottom: "1rem" }}>Sailfish Setup</h2>
      {!needLogin && (
        <ProgressIndicator currentIndex={step} style={{ marginBottom: "2rem" }}>
          <ProgressStep label="Admin" description="Create root account" />
          <ProgressStep label="Notifications" description="SMTP & webhooks" />
          <ProgressStep label="DigitalOcean" description="API credentials" />
        </ProgressIndicator>
      )}

      {notice && (
        <InlineNotification
          kind={notice.kind}
          title={notice.kind === "error" ? "Error" : "OK"}
          subtitle={notice.text}
          lowContrast
          style={{ marginBottom: "1rem" }}
        />
      )}

      {step === -1 && (
        <div>
          <TextInput
            id="login-email"
            labelText="Admin email"
            value={loginEmail}
            onChange={(e: any) => setLoginEmail(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <PasswordInput
            id="login-pass"
            labelText="Password"
            value={loginPassword}
            onChange={(e: any) => setLoginPassword(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post("/setup/login", { email: loginEmail, password: loginPassword });
                onDone();
              })
            }
          >
            {busy ? <InlineLoading /> : "Sign in"}
          </Button>
        </div>
      )}

      {step === 0 && (
        <div>
          <TextInput
            id="admin-email"
            labelText="Admin email"
            value={email}
            onChange={(e: any) => setEmail(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <PasswordInput
            id="admin-pass"
            labelText="Password (min 8 chars)"
            value={password}
            onChange={(e: any) => setPassword(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <Button
            kind="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post("/setup/admin", { email, password });
                setStep(1);
              })
            }
          >
            {busy ? <InlineLoading /> : "Create admin & continue"}
          </Button>
        </div>
      )}

      {step === 1 && (
        <div>
          <TextInput id="smtp-host" labelText="SMTP host" value={smtpHost}
            onChange={(e: any) => setSmtpHost(e.target.value)} style={{ marginBottom: "1rem" }} />
          <NumberInput id="smtp-port" label="SMTP port" value={smtpPort} min={1} max={65535}
            onChange={(e: any) => setSmtpPort(Number(e.target.value))} style={{ marginBottom: "1rem" }} />
          <TextInput id="smtp-user" labelText="SMTP username" value={smtpUser}
            onChange={(e: any) => setSmtpUser(e.target.value)} style={{ marginBottom: "1rem" }} />
          <PasswordInput id="smtp-pass" labelText="SMTP password" value={smtpPass}
            onChange={(e: any) => setSmtpPass(e.target.value)} style={{ marginBottom: "1rem" }} />
          <TextInput id="smtp-from" labelText="From address" value={smtpFrom}
            onChange={(e: any) => setSmtpFrom(e.target.value)} style={{ marginBottom: "1rem" }} />
          <TextInput id="slack" labelText="Slack webhook URL (optional)" value={slackWebhook}
            onChange={(e: any) => setSlackWebhook(e.target.value)} style={{ marginBottom: "1rem" }} />
          <TextInput id="gchat" labelText="Google Chat webhook URL (optional)" value={gchatWebhook}
            onChange={(e: any) => setGchatWebhook(e.target.value)} style={{ marginBottom: "1rem" }} />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button
              kind="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.post("/setup/smtp", {
                    host: smtpHost, port: smtpPort, username: smtpUser,
                    password: smtpPass, from: smtpFrom,
                    slack_webhook: slackWebhook, gchat_webhook: gchatWebhook,
                  });
                  const r = await api.post<{ ok: boolean; detail: string }>("/setup/smtp/test");
                  setNotice({ kind: "success", text: `Test email: ${r.detail}` });
                })
              }
            >
              {busy ? <InlineLoading /> : "Send test email"}
            </Button>
            <Button
              kind="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.post("/setup/smtp", {
                    host: smtpHost, port: smtpPort, username: smtpUser,
                    password: smtpPass, from: smtpFrom,
                    slack_webhook: slackWebhook, gchat_webhook: gchatWebhook,
                  });
                  setStep(2);
                })
              }
            >
              {busy ? <InlineLoading /> : "Save & continue"}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <PasswordInput id="do-token" labelText="DigitalOcean OAuth token (control plane)"
            value={doToken} onChange={(e: any) => setDoToken(e.target.value)}
            style={{ marginBottom: "1rem" }} />
          <PasswordInput id="model-key" labelText="$MODEL_ACCESS_KEY (inference)"
            value={modelKey} onChange={(e: any) => setModelKey(e.target.value)}
            style={{ marginBottom: "1rem" }} />
          {testResult && (
            <InlineNotification kind="info" title="Connection test" subtitle={testResult}
              lowContrast style={{ marginBottom: "1rem" }} />
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button
              kind="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.post("/setup/do", { do_token: doToken, model_access_key: modelKey });
                  const r = await api.post<{
                    ok: boolean;
                    control_plane: { ok: boolean; detail: string };
                    inference: { ok: boolean; detail: string };
                  }>("/setup/do/test");
                  setTestResult(
                    `control-plane: ${r.control_plane.detail} | inference: ${r.inference.detail}`
                  );
                })
              }
            >
              {busy ? <InlineLoading /> : "Test connection"}
            </Button>
            <Button
              kind="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.post("/setup/do", { do_token: doToken, model_access_key: modelKey });
                  await api.post("/setup/complete");
                  onDone();
                })
              }
            >
              {busy ? <InlineLoading /> : "Finish setup"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
