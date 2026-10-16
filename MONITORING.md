# Sailfish Monitoring & Insights — Design Spec

> Status: **design only** (no implementation). Covers spend intelligence (A),
> host self-monitoring (B), platform awareness (C), and router-level
> enrichment (D). Phased rollout at the bottom.

## 0. Ground rules

- **Read-only against DO.** Every new DO call is a GET (billing, monitoring,
  status). The only writes are inference calls the user already makes.
- **Nightly-lag honesty.** Billing Insights refresh nightly; intraday truth
  comes from our telemetry. Every forecast/label must say which basis it uses.
- **$4-box budget.** All new tables are append-light rollups (dozens of rows/day).
  No new processes; everything rides the existing 5-minute sync tick (plus one
  15-minute tick for status).

---

## A. GenAI spend intelligence

### A1 — Per-model spend history (foundation for A2–A4)

**New table** (append-only, ~30–60 rows/day — negligible):

```sql
CREATE TABLE billing_daily (
  day TEXT NOT NULL,              -- YYYY-MM-DD (insights start_date)
  sku TEXT NOT NULL,
  model_key TEXT NOT NULL,       -- friendly id, e.g. 'deepseek-4-flash'
  description TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  amount_usd REAL NOT NULL,
  PRIMARY KEY (day, sku, description)
);
```

**Writer:** end of `syncBilling()`, after the existing classification loop —
parse token counts from `"(N @ $P/thousand)"` descriptions (same parser as
`backfill-telemetry.mjs`, promoted into a shared helper), `INSERT … ON
CONFLICT(day, sku, description) DO UPDATE`. Retention: 400 days (covers
year-over-year month comparisons).

**Reader:** `GET /billing/daily?days=30` → `{ days: [{day, total, by_model:
{model_key: amount}}] }`. UI: "Spend by model over time" stacked-area section
on the Dashboard (reuse `AreaChart`), plus the data source for A2/A3.

### A2 — Burn-rate forecast + days-of-credit-left

**Inputs:** `billing_daily` trailing rate + today's live telemetry pace +
a **manual remaining-credit field** (see dependency below).

**New endpoint:** `GET /billing/forecast` →

```json
{
  "basis": "insights-2026-10-15 + live telemetry",
  "daily_rate_usd": 1.31,
  "projected_month_end_usd": 38.4,
  "credit_remaining_usd": 26.0,
  "credit_remaining_as_of": "2026-10-16",
  "days_of_credit_left": 19,
  "note": "insights lag ~24h; intraday pace from telemetry"
}
```

**Dependency — manual credit field.** No DO API exposes live AI-credit
remaining (probed: `/credits` 404s, `/balance` is a cached snapshot,
prepayment endpoints cover only the $10 plan). So: `app_settings`-adjacent
`ai_credit_remaining` + `ai_credit_as_of`, editable in Settings ("copied from
DO billing page"), displayed with its as-of date. This also resolves the $26
question permanently: the dashboard shows DO's number, sourced by the human,
with provenance.

**UI:** forecast strip under the billing tiles: "≈ $X/day → $Y by month-end ·
~N days of credit left (as of <date>)".

### A3 — Spike alerts via the existing threshold engine

- Migrate `thresholds.metric` CHECK to add `daily_spend_spike` (ratio) and
  `daily_spend_usd` (absolute).
- Evaluate at the end of `syncBilling()`: today's AI total (insights +
  telemetry-to-date) vs mean of prior 7 `billing_daily` days. Breach example:
  `daily_spend_spike gt 2.0`.
- Delivery reuses `notifyBreaches` → email/Slack/GChat with the existing
  `cooldown_minutes` dedupe. No new delivery code.

### A4 — Token-efficiency advisor (billing → routing feedback loop)

**New table:** `model_rates(model_key PK, input_per_1m, output_per_1m,
observed_at)` — upserted each sync from first-seen insights rates (same
source as today's hardcoded `PRICING`, but live).

**UI (advisor only — never auto-edits routers):**
- Models page: "observed $/1M in/out" column + "cheapest this week" badge.
- Router page: inline hint under policies ("cheapest observed input this
  week: deepseek-4-flash @ $0.14/1M").
- `PRICING` in `telemetry.ts` falls back to these observed rates when its
  curated table lacks a model (fixes the old $0.50 fallback silently
  mispricing new models).

---

## B. Host self-monitoring (active after droplet deploy)

### B1 — Droplet metrics for the Sailfish host

- `DOClient.dropletMetrics(hostId, metric, start, end)` →
  `GET /v2/monitoring/metrics/droplet/{cpu,memory,disk,bandwidth}?...`.
  Host discovery: `GET /v2/droplets` matched by tag (`sailfish`) with a
  manual `host_id` override in Settings.
- Phase 1: on-demand 24h charts (no storage) in a new "Host" Dashboard
  section (CPU%, memory, disk, public bandwidth — reuse `AreaChart`).
- Phase 2: `host_metrics` 5-min rollup table + CPU/mem threshold alerts
  (OOM early warning — the one that can actually kill SQLite writes on 512MB).

### B2 — App health tile (our own logs, just surfaced)

- New tiny `sync_log(ts, task, ok, detail)` — today only *successful* syncs
  leave traces; failures vanish. Tile: "last sync OK 2 min ago · 0 failures
  (24h)". Recent failure details from `notification_log`.
- Zero DO calls; pure self-observability.

---

## C. Platform awareness

### C1 — DO status banner

- Poll `https://status.digitalocean.com/api/v2/summary.json` (public, no
  auth) every 15 min; keep unresolved incidents affecting
  GenAI/inference/API in memory (persist last-seen id only).
- `<InlineNotification>` banner on the Dashboard during incidents, so a
  failed router call reads as "DO incident" instead of "my app broke".

### C2 — Agent evaluation metrics (deferred)

Accuracy/latency from GenAI evaluation jobs — spec when agents are adopted.
No work now.

---

## D. Router/task enrichment (the router-usage gap)

The router API will never report usage, so enrich **our** telemetry:

- `POST /telemetry/ingest` accepts optional `router`, `task` strings
  (backward compatible; null when callers don't send them).
- `telemetry_logs` / `telemetry_hourly` gain nullable `router`, `task`
  columns (migration; existing rows stay null).
- `GET /telemetry/by-model?group=router|task|model` + donut grouping toggle
  on the Dashboard; Router page gains a per-router 7-day cost line.
- Turns "the router picked Qwen 3×" into "summarization via Qwen cost $X".

---

## Rollout order

1. **Phase 1 (additive, low risk):** A1 table+endpoint+chart; D schema+ingest
   fields (nullable, nothing breaks); manual credit field in Settings.
2. **Phase 2 (logic on Phase-1 data):** A2 forecast; A3 threshold metrics;
   A4 rates table + advisor UI.
3. **Phase 3 (post-deploy):** B1 charts → alerts; B2 health tile; C1 banner.

## Open questions (answer before Phase 1)

1. Manual credit field: acceptable as the $26 source of truth, or do we keep
   pointing at DO's page? (Recommendation: manual + as-of date.)
2. Droplet tag/name convention for B1 auto-discovery.
3. `billing_daily` backfill depth: re-parse stored `breakdown_json` only, or
   re-fetch 90 days of insights once? (Recommendation: re-fetch once —
   one-time cost, full history.)

---

## Phase 4 — Cache effectiveness (specified, not built)

**Why:** the Oct bills show ~14M DeepSeek cache-read tokens vs ~5M regular
input — caching is already the largest cost lever, and nothing surfaces it.

### Definitions (locked)

- `hit_ratio = cache_read_tokens / (cache_read_tokens + regular_input_tokens)`
  per model and account-wide. Outputs are never cacheable and are excluded.
- `est_savings_usd = cache_read_tokens × (input_per_1m − cache_read_per_1m) / 1e6`
  using observed rates; a model without both rates is listed with "rate
  unknown" and excluded from the savings total (never silently estimated).
- Only descriptions containing **"read"** count as hits. Any other "cache"
  line (e.g. future cache-creation/write SKUs, which cost *more* than base
  input) is bucketed `cache_other`: shown separately, excluded from ratio and
  savings. Revisit if creation lines ever appear in the bills (none seen yet).

### Schema

- `model_rates` gains `cache_per_1m REAL NULLABLE` (ALTER migration via the
  existing `addColumnIfMissing` helper — the table already exists from Phase 2).
- `ratesOf()` in `billing-lines.ts` additionally returns `{ cache }` when the
  description contains "cache"; `upsertModelRates()` merges the third leg with
  the same COALESCE pattern. No changes to `billing_daily` (token counts for
  cache lines are already stored).

### API

`GET /billing/cache?days=30` →

```json
{
  "overall": { "hit_ratio": 0.73, "cache_tokens": 14086400, "est_savings_usd": 1.58 },
  "by_model": [
    { "model_key": "deepseek-4-flash", "hit_ratio": 0.8, "cache_tokens": 14086400,
      "input_tokens": 3228315, "est_savings_usd": 1.58, "rates": "observed" }
  ]
}
```

computed from `billing_daily` (token sums) × `model_rates`. Models with cache
lines but incomplete rates appear with `rates: "unknown"` and no savings.

### UI

- Dashboard tile next to Cost Distribution: "Cache hit ratio (30d)" big number
  = overall ratio, sub-line "≈ $X saved vs full input price".
- Per-model mini-table under it (model · hit % · cache tokens · saved $).
- No alerts in v1 (spike engine covers spend; cache-ratio alerting is a
  follow-up if ratio drops are ever observed to matter).

### Acceptance

1. Ratios recomputed by hand from `billing_daily` match the endpoint.
2. A model with no cache lines shows "no cache data", never 0%.
3. Savings total equals the sum of per-model savings (no hidden remainder).

---

## Phase 5 — Core compute inventory (specified, not built)

**Why now:** the $4-box constraint was hypothetical; Sailfish is a full
DigitalOcean FinOps surface. The `core` bucket, `billing_daily` model_key
`core`, and per-SKU/region insights lines already flow — this phase turns
them into an inventory.

### API (all read-only)

- `DOClient.listDroplets()` → `GET /v2/droplets?per_page=200` (id, name,
  region, size_slug, status, created_at, tags). Paginate if needed.
- Reuse `billingInsights()`: core-compute spend attribution matches insights
  lines to droplets by region + size family where SKUs allow it; anything
  unattributable stays under `core` (never forced onto a droplet).

### UI — new "Infrastructure" page (sidenav entry)

- Droplet table: name · region · size · status · created · est. MTD cost
  (attributed where possible, "shared/ unattributed" otherwise).
- Power actions are explicitly **out of scope** v1 (no start/stop/destroy —
  too destructive for a billing app). Revisit only with per-action confirm +
  audit log.
- B1 droplet metrics (Phase 3) plug into per-row expanders when built.

### Acceptance

1. With zero droplets, the page says so (like today's $0.00 tile) — no empty
   tables that look broken.
2. Attributed + unattributed core spend sums exactly to `core_compute_mtd`.
3. No write endpoints: page performs zero state-changing DO calls.
