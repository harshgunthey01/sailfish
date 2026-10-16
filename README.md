# Sailfish

**DO-Inference Billing & Router Dashboard** — a mobile-first, IBM Carbon dashboard
for DigitalOcean Serverless Inference + core compute costs. See `ARCHITECTURE.md`
for the full system design and `PRD.md` for the source requirements.

Runs on a **$4–$6 DigitalOcean Droplet** in a single Docker container:
Node.js + embedded SQLite serving a prebuilt React (Carbon) SPA.

## Quick start (local dev)

```bash
npm install
npm run dev          # server :8080 (tsx watch) + web :5173 (vite, proxies /api)
```

Open http://localhost:5173 → the setup wizard runs on first boot.

## Deploy to a $4/$6 Droplet

```bash
# one-time host setup (swap + docker)
ssh root@<droplet> 'bash -s' < deploy/setup-vm.sh

# build & run
git clone https://github.com/harshgunthey01/sailfish
cd sailfish
docker compose up -d --build
# open http://<droplet-ip>:8080
```

Memory limits in `docker-compose.yml` are tuned for the 512MB tier; comments show
the $6-tier values.

## What's inside

- **Setup wizard** (PRD §2.1): admin account → SMTP/Slack/GChat + thresholds (with
  *Send Test Email*) → DO OAuth + `$MODEL_ACCESS_KEY` (with *Test Connection*).
  All traffic is forced through `/setup` until `setup_complete`.
- **Dual billing** (PRD §2.2): polls `/v2/customers/my/balance` and
  `/v2/customers/my/prepayment_config` every 5 min; breach of user thresholds
  triggers email/Slack/Google Chat with cooldown dedupe.
- **Telemetry** (billing-only mode): clients push `usage` objects to
  `POST /api/v1/telemetry/ingest` (HMAC-authed); costs priced from a bundled table;
  hourly rollups keep 7-day charts cheap.
- **Router rules** (PRD §2.3): ordered rules, Cost⇄Latency sliders, snapshots +
  rollback (append-only history).
- **Model registry** (PRD §2.4): merged DO `/v1/models` + lifecycle states;
  REST-first, `doctl` fallback with captured stdout/stderr shown in a terminal modal.
- **Carbon UI** (PRD §3): g100-dark default with g10 toggle, `<Grid>/<Column sm={4} md={8} lg={16}>`
  (no hand-rolled media queries), ProgressIndicator wizard, AreaChart/DonutChart,
  StructuredList+Toggle, Modal+CodeSnippet.

## Telemetry snippet (client side)

```js
// after your DO inference call returns { usage }:
fetch("https://<sailfish-host>:8080/api/v1/telemetry/ingest", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer <INGEST_TOKEN from Settings>",
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
web/      Vite + React + @carbon/react SPA
deploy/   droplet bootstrap script
Dockerfile, docker-compose.yml   single-container deployment
```
