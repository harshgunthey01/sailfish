# Sailfish

**DO-Inference Billing & Router Dashboard** — a mobile-first, IBM Carbon dashboard
for DigitalOcean Serverless Inference + core compute costs. See `ARCHITECTURE.md`
for the full system design and `PRD.md` for the source requirements.

Runs in a **single Docker container** on any DigitalOcean Droplet (or any Docker
host): Node.js + embedded SQLite serving a prebuilt React (Carbon) SPA.

## Quick start (local dev)

```bash
npm install
npm run dev          # server :8080 (tsx watch) + web :5173 (vite, proxies /api)
```

Open http://localhost:5173 → the setup wizard runs on first boot.

## Deploy to a Droplet

```bash
# one-time host setup (swap + docker)
ssh root@<droplet> 'bash -s' < deploy/setup-vm.sh

# build & run
git clone https://github.com/harshgunthey01/sailfish
cd sailfish
docker compose up -d --build
# open http://<droplet-ip>:8080
```

Resource limits in `docker-compose.yml` are conservative defaults that suit
small hosts; raise them on larger machines (comments in the file show how).

## What's inside

- **Setup wizard** (PRD §2.1, §6.5): admin account → SMTP/Slack/GChat + thresholds (with
  *Send Test Email*) → DO OAuth + `$MODEL_ACCESS_KEY` (with *Test Connection*).
  All traffic is forced through `/setup` until `setup_complete`. Notifications are
  optional/skippable.
- **Settings mirrors onboarding**: every wizard step stays editable after setup —
  admin password rotation (`POST /setup/password`), full SMTP/webhook re-configuration
  (`GET`+`POST /setup/smtp`), and per-credential DO rotation (`POST /setup/do`
  accepts partial updates; blank = keep current).
- **Billing breakdown, not just balances** (PRD §2.2, §6.2): the 5-minute sync polls
  `/v2/customers/my/balance` + prepayment endpoints **and** the Billing Insights API,
  classifying every SKU line into Core Compute / GenAI usage / Tax / Credits.
  Dashboard tiles: Core Compute MTD, GenAI Usage MTD (tax inline), Prepaid Inference
  remaining (of $X prepaid), Account Payments (from `/billing_history`). Note: DO
  exposes no API for the *live* AI-credit remaining — that figure exists only on
  DO's billing page.
- **Telemetry** (billing-only mode): clients push `usage` objects to
  `POST /api/v1/telemetry/ingest` (HMAC-authed); costs priced from a bundled table
  built on real DO per-model rates; hourly rollups keep 7-day charts cheap. One-off
  `server/scripts/backfill-telemetry.mjs` seeds history from stored billing-insights lines.
- **Live model routers** (PRD §2.3, §6.3): full CRUD against DO's
  `/v2/gen-ai/models/routers` via `/api/v1/model-routers` (policies, fallback models,
  cheapest/fastest selection). DO-managed routers (e.g. `inference-router`) are tagged
  and their Edit/Delete is disabled — DO rejects those with 403. Routers are invoked
  as `model: "router:<name>"` on `https://inference.do-ai.run/v1/chat/completions`.
  The local rule engine remains as an offline advisor.
- **Model registry** (PRD §2.4): merged DO `/v1/models` + lifecycle states;
  REST-first, `doctl` fallback with captured stdout/stderr shown in a terminal modal.
- **Backups** (PRD §6.7): automatic daily SQLite snapshots (`VACUUM INTO`,
  newest 7 kept, plus one at boot when stale) with one-click Backup now,
  Download, staged Restore (safety snapshot first, applied on restart), and
  Delete — all in Settings. No external tooling; single-tenant by design.
- **Carbon UI** (PRD §3): g100-dark default with g10 toggle applied to `<html>`
  (`cds--g100`/`cds--g10` classes, so the whole page themes), `<Grid>/<Column sm={4} md={8} lg={16}>`
  (no hand-rolled media queries), ProgressIndicator wizard, AreaChart/DonutChart,
  StructuredList+Toggle, Modal+CodeSnippet.

## Telemetry snippet (client side)

```js
// after your DO inference call returns { usage }:
fetch("https://<sailfish-host>:8080/api/v1/telemetry/ingest", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer <ingest token>",
  },
  body: JSON.stringify({
    model_id: model,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
  }),
});
```

`INGEST_TOKEN` = HMAC-SHA256(`sailfish-ingest-v1`, your `$MODEL_ACCESS_KEY`) — compute it
once server-side; never ship the raw DO key to clients.

## Repo layout

```
server/   Hono + node:sqlite backend (TypeScript)
  scripts/  ops helpers: billing probes, telemetry backfill/clear,
              router listing + invocation tools
web/      Vite + React + @carbon/react SPA
deploy/   droplet bootstrap script
Dockerfile, docker-compose.yml   single-container deployment
```
