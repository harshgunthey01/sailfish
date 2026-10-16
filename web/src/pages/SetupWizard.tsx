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
  // The wizard is shown only when the app is NOT set up.
  // `needLogin` is true only when the user already has an admin account (so they just need to sign in).

  const [step, setStep] = useState(needLogin ? -1 : 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // step 1
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // password recovery (login screen only)
  const initialToken =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token")
      : null;
  const [authMode, setAuthMode] = useState<"login" | "forgot" | "reset">(
    initialToken ? "reset" : "login"
  );
  const [resetToken] = useState(initialToken ?? "");
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetPass1, setResetPass1] = useState("");
  const [resetPass2, setResetPass2] = useState("");

  const clearResetTokenFromUrl = () => {
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("token");
      window.history.replaceState({}, "", u.pathname + (u.search ? "?" + u.searchParams : ""));
    } catch {
      /* non-browser */
    }
  };

  // disaster recovery (first boot only)
  const [showRecover, setShowRecover] = useState(false);
  const [recoverTab, setRecoverTab] = useState<"file" | "s3">("file");
  const [rcEndpoint, setRcEndpoint] = useState("");
  const [rcBucket, setRcBucket] = useState("");
  const [rcRegion, setRcRegion] = useState("us-east-1");
  const [rcKey, setRcKey] = useState("");
  const [rcSecret, setRcSecret] = useState("");
  const [rcPrefix, setRcPrefix] = useState("sailfish/");
  const [rcObjects, setRcObjects] = useState<Array<{ key: string; bytes: number }>>([]);
  const [rcSaveCreds, setRcSaveCreds] = useState(true);

  // step 2
  const [smtpHost, setSmtpHost] = useState("");  const [smtpPort, setSmtpPort] = useState(587);
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
      <h2 style={{ marginBottom: "0.25rem" }}>
        {needLogin ? "Welcome back" : "Welcome to Sailfish"}
      </h2>
      <p className="sf-muted" style={{ marginBottom: "1.5rem" }}>
        {needLogin
          ? "Sign in with the administrator account you created during setup."
          : "First-run setup. We'll walk you through creating your admin account, connecting notifications, and linking DigitalOcean. Takes about 2 minutes."}
      </p>
      {!needLogin && (
        <ProgressIndicator currentIndex={step} style={{ marginBottom: "2rem" }}>
          <ProgressStep label="Admin account" description="Create your login" />
          <ProgressStep label="Notifications" description="SMTP & webhooks (optional)" />
          <ProgressStep label="DigitalOcean" description="Connect your API keys" />
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

      {step === -1 && authMode === "login" && (
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
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
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
            <Button kind="ghost" disabled={busy} onClick={() => setAuthMode("forgot")}>
              Forgot password?
            </Button>
          </div>
        </div>
      )}

      {step === -1 && authMode === "forgot" && (
        <div>
          <p className="sf-muted" style={{ marginBottom: "1rem" }}>
            Enter your admin email. If the account exists and email notifications are
            configured, a single-use reset link (15 minutes) will be sent.
          </p>
          <TextInput
            id="forgot-email"
            labelText="Admin email"
            value={forgotEmail}
            onChange={(e: any) => setForgotEmail(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Button
              kind="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.post("/setup/password/forgot", { email: forgotEmail });
                  setNotice({
                    kind: "success",
                    text: "If the account exists, a reset link is on its way. Check your inbox (and spam).",
                  });
                  setAuthMode("login");
                })
              }
            >
              {busy ? <InlineLoading /> : "Send reset link"}
            </Button>
            <Button kind="ghost" disabled={busy} onClick={() => setAuthMode("login")}>
              Back to sign in
            </Button>
          </div>
        </div>
      )}

      {step === -1 && authMode === "reset" && (
        <div>
          <p className="sf-muted" style={{ marginBottom: "1rem" }}>
            Choose a new password for your admin account. The link is single-use.
          </p>
          <PasswordInput
            id="reset-pass1"
            labelText="New password (min 8 chars)"
            value={resetPass1}
            onChange={(e: any) => setResetPass1(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <PasswordInput
            id="reset-pass2"
            labelText="Confirm new password"
            value={resetPass2}
            onChange={(e: any) => setResetPass2(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Button
              kind="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (resetPass1 !== resetPass2) throw new Error("Passwords do not match.");
                  await api.post("/setup/password/reset", {
                    token: resetToken,
                    new_password: resetPass1,
                  });
                  clearResetTokenFromUrl();
                  setResetPass1("");
                  setResetPass2("");
                  setAuthMode("login");
                  setNotice({
                    kind: "success",
                    text: "Password changed. Sign in with your new password.",
                  });
                })
              }
            >
              {busy ? <InlineLoading /> : "Set new password"}
            </Button>
            <Button
              kind="ghost"
              disabled={busy}
              onClick={() => {
                clearResetTokenFromUrl();
                setAuthMode("login");
              }}
            >
              Back to sign in
            </Button>
          </div>
        </div>
      )}

      {step === 0 && !showRecover && (
        <div>
          <p className="sf-muted" style={{ marginBottom: "1rem" }}>
            Choose the email and password <strong>you</strong> will use to sign in to
            this dashboard. This creates your administrator account — you're not
            signing into anything yet.
          </p>
          <TextInput
            id="admin-email"
            labelText="Your email (becomes your login)"
            value={email}
            onChange={(e: any) => setEmail(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <PasswordInput
            id="admin-pass"
            labelText="Choose a password (min 8 chars)"
            value={password}
            onChange={(e: any) => setPassword(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
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
              {busy ? <InlineLoading /> : "Create account & continue"}
            </Button>
            <Button kind="ghost" disabled={busy} onClick={() => setShowRecover(true)}>
              Recover from backup instead
            </Button>
          </div>
        </div>
      )}

      {step === 0 && showRecover && (
        <div>
          <p className="sf-muted" style={{ marginBottom: "1rem" }}>
            Restore this instance from a backup, then restart the app to apply it.
            The uploaded file is validated before anything is staged.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <Button
              kind={recoverTab === "file" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setRecoverTab("file")}
            >
              Upload file
            </Button>
            <Button
              kind={recoverTab === "s3" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setRecoverTab("s3")}
            >
              Fetch from S3
            </Button>
          </div>

          {recoverTab === "file" && (
            <div>
              <input
                id="recover-file"
                type="file"
                accept=".db"
                style={{ marginBottom: "1rem" }}
                onChange={(e: any) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.append("backup", f);
                  run(async () => {
                    const res = await fetch("/api/v1/setup/restore/upload", {
                      method: "POST",
                      body: fd,
                    });
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status})`);
                    setNotice({
                      kind: "success",
                      text: `Restore staged from ${j.file} (safety: ${j.safety}). Restart the app to apply, then sign in with your original credentials.`,
                    });
                  });
                }}
              />
            </div>
          )}

          {recoverTab === "s3" && (
            <div>
              <TextInput id="rc-endpoint" labelText="S3 endpoint (https://…)" value={rcEndpoint}
                onChange={(e: any) => setRcEndpoint(e.target.value)} style={{ marginBottom: "1rem" }} />
              <TextInput id="rc-bucket" labelText="Bucket" value={rcBucket}
                onChange={(e: any) => setRcBucket(e.target.value)} style={{ marginBottom: "1rem" }} />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <TextInput id="rc-region" labelText="Region" value={rcRegion}
                  onChange={(e: any) => setRcRegion(e.target.value)} style={{ marginBottom: "1rem" }} />
                <TextInput id="rc-prefix" labelText="Prefix" value={rcPrefix}
                  onChange={(e: any) => setRcPrefix(e.target.value)} style={{ marginBottom: "1rem" }} />
              </div>
              <TextInput id="rc-key" labelText="Access key" value={rcKey}
                onChange={(e: any) => setRcKey(e.target.value)} style={{ marginBottom: "1rem" }} />
              <PasswordInput id="rc-secret" labelText="Secret key" value={rcSecret}
                onChange={(e: any) => setRcSecret(e.target.value)} style={{ marginBottom: "1rem" }} />
              <Checkbox id="rc-save" labelText="Remember these S3 settings for future backups"
                checked={rcSaveCreds} onChange={(v: any) => setRcSaveCreds(typeof v === "boolean" ? v : v.target.checked)} />
              <div style={{ display: "flex", gap: "0.5rem", margin: "0.75rem 0" }}>
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await api.post<{ objects: Array<{ key: string; bytes: number }> }>(
                        "/setup/restore/s3-list",
                        {
                          endpoint: rcEndpoint, bucket: rcBucket, region: rcRegion,
                          access_key: rcKey, secret_key: rcSecret, prefix: rcPrefix,
                        }
                      );
                      setRcObjects(r.objects);
                      if (!r.objects.length)
                        setNotice({ kind: "success", text: "Connected — no backup objects under that prefix." });
                    })
                  }
                >
                  {busy ? <InlineLoading /> : "List backups"}
                </Button>
              </div>
              {rcObjects.map((o) => (
                <div key={o.key} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span className="sf-muted" style={{ flex: 1 }}>{o.key} ({(o.bytes / 1024).toFixed(1)} KB)</span>
                  <Button
                    kind="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await api.post<{ ok: boolean; file: string; safety: string }>(
                          "/setup/restore/s3-fetch",
                          {
                            endpoint: rcEndpoint, bucket: rcBucket, region: rcRegion,
                            access_key: rcKey, secret_key: rcSecret, prefix: rcPrefix,
                            key: o.key, save_credentials: rcSaveCreds,
                          }
                        );
                        setNotice({
                          kind: "success",
                          text: `Restore staged from ${r.file} (safety: ${r.safety}). Restart the app to apply, then sign in with your original credentials.`,
                        });
                      })
                    }
                  >
                    Restore this
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button kind="ghost" disabled={busy} onClick={() => setShowRecover(false)}>
            Back to new setup
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
            <Button kind="ghost" disabled={busy} onClick={() => setStep(2)}>
              Skip for now
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <p className="sf-muted" style={{ marginBottom: "1rem" }}>
            Two keys are needed. You can find or generate them from your
            DigitalOcean account panel:
          </p>
          <ul className="sf-muted" style={{ marginBottom: "1rem", paddingLeft: "1.2rem" }}>
            <li><strong>OAuth token</strong> — API → Tokens/Keys → Generate New Token (read + write for billing access to /v2/customers/my/balance)</li>
            <li><strong>$MODEL_ACCESS_KEY</strong> — API → Inference → Model Access Key (for /v1/models and inference APIs)</li>
          </ul>
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
