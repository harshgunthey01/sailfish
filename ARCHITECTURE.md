# Sailfish — System Architecture & Design Document

**Project:** DO-Inference Billing & Router Dashboard ("Sailfish")
**Source PRD:** `PRD.md` (extracted from `DO-Inference Billing & Router Dashboard PRD.pdf`)
**Target host:** DigitalOcean $4–$6 Droplet (512MB–1GB RAM, 1 vCPU), single Docker container
**Status:** Draft v1 — for review before coding

---

## 1. Design Constraints & Principles

1. **One process, one container.** At 512MB–1GB RAM we cannot afford multiple daemons.
   The entire backend is a single Node.js process with embedded SQLite.
2. **Static frontend.** React (IBM Carbon) is built at image-build time and served as
   static files by the backend. No dev server, no SSR, no separate web container.
3. **No external DB server.** SQLite via `better-sqlite3` (synchronous, zero-config,
   single file, backups = file copy).
4. **PRD schema fidelity.** SQLite tables mirror the PRD's PocketBase collections
   1:1 (`telemetry_logs`, `billing_state`, `router_rules`, `managed_models`,
   `app_settings`) so PRD-driven codegen and future migration to PocketBase stay trivial.
5. **REST-first, `doctl` fallback.** All DigitalOcean interactions use public REST
   APIs where they exist; model provisioning/deprovisioning shells out to `doctl`
   only when no API equivalent exists, with stdout/stderr captured for the
   Terminal Output Modal.
6. **Billing-only polling (no live proxy).** The VM never sits in the inference
   request path. Token telemetry arrives via a client-side ingestion endpoint.
7. **Fail-safe defaults.** Every external integration (SMTP, webhooks, polling) is
   optional, retried with backoff, and degrades to in-app notifications.

---

## 2. Deviation From PRD: PocketBase → Node/SQLite Monolith

The PRD names PocketBase as the backend. We intentionally deviate:

| Concern | PocketBase on 512MB VM | Node + SQLite monolith |
|---|---|---|
| Idle RAM | ~50–100MB, grows with JSVM (goja) hook load | ~60–90MB, predictable |
| npm ecosystem in hooks | Not available (goja sandbox) | Full access (undici, carbon charts tooling, nodemailer) |
| Type safety / testability | Weak (untyped JSVM) | TypeScript end-to-end, unit-testable services |
| Cron / background jobs | Built-in | Built-in via in-process scheduler (node-cron or hand-rolled) |
| Admin auth | Built-in | Implemented once (session cookie + scrypt/bcrypt) — small surface |
| Realtime subscriptions | Built-in | SSE (Server-Sent Events) endpoint — sufficient for dashboard refresh |

**Mitigation for schema fidelity:** table names, column names, and semantics match
the PRD's collections exactly (Section 7). A future swap to PocketBase remains a
mechanical migration.

*If the reviewer insists on literal PocketBase:* the architecture below still holds
with PocketBase replacing the Node backend (JS hooks implement `services/`), but we
recommend against it for the reasons above.

---

## 3. High-Level Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │            DO Droplet $4–$6                 │
                    │  (1 vCPU, 512MB–1GB RAM, 1GB swapfile)         │
                    │                                          │
   HTTPS ──▶ Caddy? │  ┌──────────────────────────────────────┐  │
   (or DO LB/      │  │        Docker container: sailfish    │  │
    plain HTTP +  │  │                                      │  │
    DO cloud      │  │  Node.js single process              │  │
    firewall;     │  │  ┌────────────┐  ┌─────────────────┐  │  │
    TLS via       │  │  │ Static     │  │ REST API (Hono/ │  │  │
    built-in      │  │  │ React SPA  │  │ Fastify)        │  │  │
    acme or DO    │  │  │ (Carbon)   │  │  /api/v1/...    │  │  │
    managed cert) │  │  └────────────┘  └───────┬─────────┘  │  │
                    │  │                    │             │  │
                    │  │  ┌─────────────────▼──────────┐  │  │
                    │  │  │ Service layer (TS)        │  │  │
                    │  │  │ • billing-sync (poller)   │  │  │
                    │  │  │ • telemetry-ingest      │  │  │
                    │  │  │ • router-engine       │  │  │
                    │  │  │ • model-manager (REST/  │  │  │
                    │  │  │   doctl fallback)       │  │  │
                    │  │  │ • notifier (SMTP/Slack/ │  │  │
                    │  │  │   GChat)                │  │  │
                    │  │  │ • scheduler (cron)      │  │  │
                    │  │  └──────────┬───────────────┘  │  │
                    │  │  ┌──────────▼───────────────┐  │  │
                    │  │  │ SQLite (better-sqlite3)  │  │  │
                    │  │  │ /data/sailfish.db       │  │  │
                    │  │  └────────────────────────┘  │  │
                    │  └──────────────────────────────────────┘  │
                    └───────────────────────────────────────────┘
                                        │  outbound HTTPS only
                          ┌─────────────┼───────────────┬──────────────┐
                          ▼             ▼               ▼              ▼
                  DO Control Plane  DO Inference   Slack /        SMTP relay
                  /v2/* (billing)   /v1/models     Google Chat
```

**Inbound:** browser → SPA + `/api/v1/*` + `/api/v1/telemetry/ingest`.
**Outbound:** billing poller → DO `/v2/*`; model-manager → DO `/v1/*` + optional `doctl`;
notifier → Slack/Google Chat/SMTP.

No inbound webhooks required (Billing-only polling mode); everything is pull-based
except telemetry ingest, which is a client-pushed POST.

---

## 4. Container & Deployment Design ($4-tier hardening)

### 4.1 Image
- Multi-stage `Dockerfile`:
  - Stage 1 `node:22-alpine AS build`: `npm ci`, `vite build` (React+Carbon), `tsc`/`esbuild` bundle backend to a single JS file.
  - Stage 2 `node:22-alpine`: copy `dist/` (static SPA) + `server.js` + `doctl` binary (for fallback ops) only.
- Final image ~120–180MB. No dev dependencies, no source maps in runtime stage.

### 4.2 Runtime limits
```yaml
services:
  sailfish:
    image: sailfish:latest
    restart: unless-stopped
    mem_limit: 384m          # leave headroom for OS+dockerd on 512MB VM
    memswap_limit: 1g      # allow burst into swap
    cpus: "1.0"
    environment:
      NODE_OPTIONS: --max-old-space-size=192
      DATA_DIR: /data
    volumes:
      - sailfish-data:/data   # sqlite db, secrets file, doctl config
    ports:
      - "8080:8080"
```
- Host one-time setup (documented in `deploy/setup-vm.sh`):
  - `fallocate -l 1G /swapfile && mkswap /swapfile && swapon` (+ fstab entry)
  - `vm.swappiness=10`
- Secrets (DO OAuth token, `$MODEL_ACCESS_KEY`, SMTP password) live in an
  **encrypted-at-rest app-owned file** (`/data/vault.json`, AES-256-GCM with a key
  derived from a machine-secret created at setup). Never in SQLite plaintext,
  never in env after first boot where avoidable.

### 4.3 TLS
Recommended: run behind **DO's $0 cloud firewall + Caddy** only if budget allows;
on $4 tier, default to HTTP on :8080 with an explicit hardening note (bind to
private IP / firewall to trusted IPs, or put Caddy in the *same* container only if
RAM permits — default OFF). Documented upgrade path to Caddy sidecar at $6 tier.

---

## 5. Backend Module Layout (TypeScript)

```
server/
  index.ts               # bootstrap: db migrate, scheduler start, http listen
  config.ts              # env + runtime flags
  db/
    schema.ts            # DDL migrations (PRD collections 1:1)
    client.ts            # better-sqlite3 singleton, WAL mode, busy_timeout
  auth/
    admin.ts             # setup wizard account create, session cookies (httpOnly)
    middleware.ts        # force-redirect to /setup until app_settings.setup_complete
  api/
    routes/
      setup.ts           # POST /api/v1/setup/{admin,smtp,do} + test actions
      billing.ts         # GET /api/v1/billing/summary|history
      telemetry.ts      # POST /api/v1/telemetry/ingest, GET /api/v1/telemetry/series
      router.ts         # CRUD /api/v1/router/rules + snapshots/rollback
      models.ts         # GET/POST/DELETE /api/v1/models (+ async job status)
      notifications.ts # GET/POST /api/v1/notification-log, threshold config
      system.ts         # GET /api/v1/health, SSE /api/v1/events
  services/
    billing-sync.ts     # poller: balance + prepayment_config + invoices
    thresholds.ts       # evaluate user-defined triggers after each sync
    notifier.ts         # SMTP (nodemailer), Slack webhook, GChat webhook
    router-engine.ts    # pure functions: rule match/order, cost-vs-latency weights
    model-manager.ts    # REST /v1/models; doctl exec fallback w/ captured output
    jobs.ts             # tiny in-process job queue (model deploy/remove), status polling
    scheduler.ts        # cron-ish setInterval registry w/ jitter + backoff
    vault.ts            # AES-256-GCM secret store on /data/vault.json
  do/
    client.ts           # typed DO REST client (undici), retries, timeouts
    cli.ts              # doctl wrapper (spawn, timeout, capture stdout/stderr)
web/                      # React 18 + Carbon SPA (Vite)
  src/
    App.tsx             # <Theme> g100 default + toggle, <Header>+<SideNav>
    pages/ Setup, Dashboard, Router, Models, Settings
    components/         # Carbon mappings per PRD §3
```

Framework choices (boring, small, fast):
- HTTP: **Hono** (tiny, fast, TS-first) or Fastify; Hono preferred for footprint.
- ORM: none — `better-sqlite3` + tiny migration runner (schema-as-code).
- Frontend: Vite + React + `@carbon/react` + `@carbon/charts-react`.

---

## 6. Key Flows

### 6.1 First Boot / Setup Wizard (PRD §2.1)
1. `app_settings.setup_complete = false` → API middleware returns
   `{ "redirect": "/setup" }` for all non-setup routes; SPA router enforces too.
2. Step 1 `POST /api/v1/setup/admin` → create scrypt-hashed admin, issue session.
3. Step 2 `POST /api/v1/setup/smtp` (+ Slack/GChat webhook URLs + thresholds);
   `POST /api/v1/setup/smtp/test` sends test mail synchronously.
4. Step 3 `POST /api/v1/setup/do` stores tokens in vault;
   `POST /api/v1/setup/do/test` hits `/v2/customers/my/balance` and `/v1/models`.
5. `POST /api/v1/setup/complete` flips `setup_complete=true`, seeds singleton rows,
   starts poller.

### 6.2 Billing Sync (PRD §2.2)
- Every 5 min (configurable):
  - `GET /v2/customers/my/balance` → `month_to_date_balance` → `billing_state.compute_balance`
  - `GET /v2/customers/my/balance/history` + `GET /v2/customers/my/invoices` (open only) for context
  - `GET /v2/customers/my/prepayment_config` → `inference_balance`, `spend_limit`, `prepay_threshold`
- Upsert single `billing_state` row (singleton) with `last_synced`; append to
  `billing_history` (new table) for sparkline/chart history.
- After each sync, `thresholds.ts` evaluates rules → on breach:
  `billing_state.is_blocked=true` + `notifier.ts` fan-out (SMTP/Slack/GChat) with
  per-channel dedupe cooldown (e.g., 1h) to avoid spam.

### 6.3 Telemetry Ingest (billing-only mode compromise)
- Client snippet (documented, ~10 lines) or OpenAI-SDK `baseURL` shim POSTs the
  `usage` object after each completion:
  `POST /api/v1/telemetry/ingest` with `Authorization: Bearer <MODEL_ACCESS_KEY-derived HMAC>`
  Body: `{ model_id, prompt_tokens, completion_tokens, total_tokens?, ts? }`
- Server computes `total_cost_usd` from a bundled per-model price table
  (maintained in `server/do/pricing.json`, overridable via UI later).
- Aggregations for charts are precomputed hourly (`telemetry_hourly` rollup table)
  so 7-day AreaChart is a cheap read, keeping SQLite small on the tiny VM.
- `telemetry_logs` retains raw rows 30 days (pruning job), rollups retained 1y.

### 6.4 Router Rules (PRD §2.3)
- CRUD over `router_rules` (ordered by `position` column).
- `router-engine.ts` pure logic: given rules + a request descriptor (size/complexity
  hints), produce ordered target list with `priority_metric` bias; sliders map to a
  0..100 `cost_weight` per rule (saved, used for offline "what-if" cost estimate
  against telemetry — no live enforcement in billing-only mode; documented).
- Snapshots: `router_snapshots` table stores JSON of rule set + author + ts;
  rollback = restore snapshot (new snapshot created first — append-only history).

### 6.5 Model Management (PRD §2.4)
- `GET /api/v1/models` → merge DO `/v1/models` (available) with `managed_models`
  (lifecycle state).
- Add/Remove: enqueue job in `jobs.ts`; worker tries REST equivalent first;
  if 404/unsupported → `doctl` fallback (`doctl serverless` / GPU-less inference is
  account-level, so most ops are no-ops — UI surfaces honest status).
  Every exec captures stdout/stderr → stored on job → surfaced in the
  Terminal Output `<Modal><CodeSnippet>` per PRD §3.3.
- Status transitions: `Deploying → Active | Removed`; poller refreshes states.

### 6.6 Notifications (PRD §2.2 automation hooks)
- Channels: SMTP (nodemailer), Slack incoming webhook (channel or DM via bot),
  Google Chat webhook.
- `notification_log` table for audit + UI history; retry with exponential backoff
  (3 attempts), never blocks the sync loop.

---

## 7. Database Schema (SQLite, PRD §4.1 1:1 + minimal additions)

PRD tables kept verbatim (names/types): `telemetry_logs`, `billing_state`,
`router_rules`, `managed_models`, `app_settings`.

Additions (each justified):
- `billing_history(id, ts, compute_balance, inference_balance, spend_limit)` — charts.
- `telemetry_hourly(hour_ts, model_id, prompt_tokens, completion_tokens, cost_usd, requests)` — cheap aggregations.
- `router_snapshots(id, ts, label, rules_json)` — version control (PRD §2.3).
- `jobs(id, type, status, payload_json, stdout, stderr, created_at, updated_at)` — async CLI/REST ops.
- `notification_log(id, ts, channel, event, status, detail)` — audit.
- `sessions(id, admin_id, token_hash, expires_at)` — auth.
- `admins(id, email, password_hash, created_at)` — setup wizard account.

Constraints mirror PRD: indexes on `telemetry_logs(timestamp)`,
`managed_models.model_name UNIQUE`, floats stored as REAL with 6-decimal rounding
for costs, `app_settings` enforced singleton (id=1).

---

## 8. Frontend Architecture (PRD §3)

- Vite + React + `@carbon/react` + `@carbon/charts-react` + `@carbon/icons-react`.
- Root `<Theme theme={g100}>` default dark; toggle persists to localStorage + swaps `g10`.
- `<Header>` + hamburger `<SideNav>`; routes: `/setup`, `/`, `/router`, `/models`,
  `/settings`, `/notifications`.
- `<Grid>/<Column sm={4} md={8} lg={16}>`; **no hand-rolled media queries** (PRD rule).
- Data layer: tiny `fetch` client + SSE subscription for live refresh;
  react-query optional (skip if bundle budget tight; plain hooks suffice).
- Component mapping exactly per PRD §3.2 table
  (ClickableTile/GaugeChart header stats, AreaChart 7-day burn, DonutChart by model,
  Accordion+Slider router, StructuredList+Toggle models, ProgressIndicator wizard,
  InlineLoading states, Modal+CodeSnippet terminal fallback).
- Bundle discipline for the tiny VM is irrelevant (static files, client-side),
  but code-split charts to keep first paint fast on mobile.

---

## 9. Security Model

- Admin-only app (single-tenant). Session cookies: `HttpOnly; SameSite=Strict; Secure` when TLS on.
- Secrets in `vault.json` (AES-256-GCM); key = HKDF(machine-id file created at setup + optional user passphrase).
- Setup routes disabled after `setup_complete` (re-setup requires CLI flag/file removal).
- Telemetry ingest auth: HMAC token derived from model key (so external snippet never holds raw DO key).
- DO tokens used server-side only; never sent to browser (SPA calls our proxy routes).
- Rate limits on ingest (token bucket) to protect the small VM.
- `doctl` invocations: fixed argument allow-list, no shell interpolation, 30s timeout.

---

## 10. Operational Concerns on a $4 VM

- **Backups:** daily SQLite `VACUUM INTO` to `/data/backups/` (7-day retention), optional rclone/S3 push documented.
- **Logs:** structured JSON to stdout; Docker `json-file` with `max-size=10m max-file=2`.
- **Updates:** `docker compose pull && up -d`; image tags pinned.
- **Watchdog:** `restart: unless-stopped` + `/api/v1/health` for external UptimeRobot (free).
- **Memory guards:** nightly pruning jobs (telemetry 30d, notif log 90d); hourly rollups keep query cost flat.

---

## 11. Build & Repo Layout

```
Sailfish/
  PRD.md
  ARCHITECTURE.md          (this doc)
  docker-compose.yml
  Dockerfile
  deploy/setup-vm.sh       (swap, firewall, docker install)
  server/ …                (§5)
  web/ …                   (§8)
  package.json (workspaces: server, web)
```

## 12. Milestones (proposed order)

1. **M0 Scaffolding:** repo, docker, CI-less local run, health endpoint.
2. **M1 Setup wizard end-to-end** (admin, smtp test, DO test, vault).
3. **M2 Billing sync + dashboard header/charts** (read-only value first).
4. **M3 Telemetry ingest + charts** (hourly rollups, pruning).
5. **M4 Router rules CRUD + snapshots/rollback** (offline optimization UI).
6. **M5 Model registry + jobs + doctl fallback + terminal modal.
7. **M6 Notifications (SMTP/Slack/GChat) + thresholds.**
8. **M7 Hardening:** backups, rate limits, docs, $4 VM load-test pass.

---

## 13. Open Questions / Risks

- DO `prepayment_config` field names must be confirmed live during M2 (schema drift guard: store raw JSON alongside parsed fields).
- `doctl` inside alpine image adds ~40MB; acceptable, but we ship it only in the runtime stage.
- If DO ever adds a public router-config API, `router-engine` can graduate from offline advisor to live enforcer without schema changes.
