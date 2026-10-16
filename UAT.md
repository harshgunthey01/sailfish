# Sailfish UAT Plan

> Manual acceptance testing. Unit/automated tests are a separate later
> workstream (see §9). Run against a **real browser** (charts don't lay out
> headless) pointed at the dev server (`http://localhost:9000`) or the
> deployed droplet.
>
> Conventions: **P** = precondition. Mark each case ✅/❌ + date + tester.
> Anything requiring live credentials is tagged **[LIVE]** (spends cents or
> touches real infra) — skip or substitute where noted.

## 0. Environment setup

- UAT-000 — Server boots clean: `PORT=9000 npx tsx src/index.ts` (from
  `server/`) prints `listening` + a `billing-sync ok` line within ~10s, no
  stack traces. **Expected:** both lines present; exit stays running.
- UAT-001 — Fresh DB (optional): stop server, rename `server/data` aside,
  restart → forced setup wizard at `/`. **Expected:** wizard, not dashboard.
  Restore the real `data/` dir afterwards.

## 1. Onboarding wizard

- UAT-100 — Create admin: enter email + 8+ char password → Continue.
  **Expected:** advances to Notifications step; reload keeps session.
- UAT-101 — Short password rejected. **Expected:** inline error, no advance.
- UAT-102 — Skip notifications → DO step → enter both keys → Test connection.
  **Expected:** `control-plane: … | inference: …` details shown.
- UAT-103 — Bad DO token → Test connection. **Expected:** clear failure text,
  setup NOT completed.
- UAT-104 — Finish setup → dashboard. **Expected:** wizard gone; direct `/`
  loads Dashboard on revisit.
- UAT-105 — SMTP path: fill host/port/user/pass/from → Save & send test
  email **[LIVE]**. **Expected:** success notice; email arrives.
- UAT-106 — Logout → login with wrong password. **Expected:** 401 error text,
  stays on login.
- UAT-107 — Forgot password (no SMTP): click Forgot → submit admin email.
  **Expected:** neutral success message; server log shows email failure; no
  inbox change; no account enumeration (same message for unknown address).
- UAT-108 — Forgot password (SMTP configured) **[LIVE]**: submit → reset
  email arrives with `/reset?token=` link.
- UAT-109 — Reset via link: open link → mismatch passwords → submit.
  **Expected:** "do not match", no change.
- UAT-110 — Reset via link: matching 8+ passwords → submit. **Expected:**
  success → login with NEW password works, OLD fails, other sessions die,
  link reuse fails with "invalid or expired link".
- UAT-111 — Expired/tampered token (append `?token=garbage`). **Expected:**
  400 "invalid or expired link" on submit.
- UAT-112 — Recovery view reachable on fresh boot: "Recover from backup
  instead" visible at step 0 (verify on a scratch `data/` dir, then restore).
- UAT-113 — Upload invalid file (e.g. `.txt`) in recovery. **Expected:**
  rejected with reason, nothing staged.
- UAT-114 — Upload valid `.db` snapshot. **Expected:** staged + safety
  snapshot noted; restart applies it (verify pre-existing rows return).
- UAT-115 — Recovery endpoints blocked post-setup: with setup complete,
  `POST /setup/restore/upload| s3-list | s3-fetch` → **403** with the
  Settings-redirect message.
- UAT-116 — Recovery S3 tab: wrong credentials → List. **Expected:** clean
  400 error text, no crash.

## 2. Dashboard

- UAT-200 — Four tiles render with last-synced time: Core $0.00, GenAI
  $59.18-class value + tax line, Prepaid $0.00 of $10.00, Payments $50.00
  + Visa line + credit line. **Expected:** no "—" blanks after sync.
- UAT-201 — Sync now button: click → `InlineLoading` → tiles refresh.
- UAT-202 — Forecast strip present: `≈ $X/day → $Y by YYYY-MM-DD · ~N days
  of credit left (as of …)`. **Expected:** arithmetic matches
  (`mtd/elapsed`, `rate×days`, `credit÷rate`).
- UAT-203 — Budget bar (with an active budget): progress + pace label;
  click → lands on Settings. Without budgets: strip absent, no error.
- UAT-204 — Token burn area chart renders 6 model series with legend.
- UAT-205 — Donut shows 6 slices with % labels summing ~100%.
- UAT-206 — Daily stacked area renders with date axis; legend matches donut.
- UAT-207 — Cache section: 85.7%-class ratio, ≈$ savings, 6-row table; a
  model with no cache lines would show "no cache data" (verify text only if
  present, else code-review).
- UAT-208 — Theme toggle: switch dark→light→dark. **Expected:** whole page
  re-themes incl. charts (remount, no stale colors); muted text stays
  readable; preference persists after reload.
- UAT-209 — Mobile width (360px): tiles stack, no horizontal scroll; sidenav
  pushes content (no overlay).

## 3. Router page

- UAT-300 — Existing routers list shows live DO routers with uuid, regions,
  fallback tags, policies. **Expected:** matches `do-code-creator` config.
- UAT-301 — Managed router (`inference-router`): "Managed by DigitalOcean"
  tag, explanatory text, NO Edit/Delete buttons.
- UAT-302 — Create router (test name, e.g. `uat-probe`): valid fallbacks +
  one policy → Create. **Expected:** appears in list; **then delete it**.
- UAT-303 — Validation: uppercase name / empty fallbacks → inline errors,
  no API call.
- UAT-304 — Edit `uat-probe` description → save → list reflects change;
  delete it → confirm → gone after reload.
- UAT-305 — Delete `inference-router` impossible via UI (no button); direct
  `DELETE /model-routers/<uuid>` **[LIVE, read the 403]**: expect DO 403
  surfaced (not 500/502), list unchanged.
- UAT-306 — Cheapest-input hint line present under intro.
- UAT-307 — Offline advisor: add rule → appears; snapshot → mutate → rollback
  restores. (Local only, no DO calls.)
- UAT-308 — Clean up: no `uat-*` routers remain (list check).

## 4. Models page

- UAT-400 — Fleet table shows managed models with status tags; Retire asks
  confirm then removes row entirely (verify reload).
- UAT-401 — Toggle off → `Removed` gray tag retained (history kept);
  toggle on → re-provisions.
- UAT-402 — Malformed job payload cannot blank the page (code-reviewed;
  exercise via logs buttons on every row).
- UAT-403 — Available section: `live` tag, 80+ models, search filters
  (e.g. "glm" narrows), Add on an already-managed model hidden from list.
- UAT-404 — Add duplicate model name → clean error notice (no crash).
- UAT-405 — Rates column shows `$/1M in·out` + cheapest badge on the min
  input-rate model.
- UAT-406 — logs buttons open terminal modal with stdout/stderr sections.

## 5. Infrastructure page

- UAT-500 — Zero-droplet state: "No droplets…" + "No core-compute spend…",
  counts 0, no broken tables.
- UAT-501 — Nav entries present (header + sidenav); route loads directly
  via URL when logged in.

## 6. Settings

- UAT-600 — Admin: wrong current password → 401 text; correct → success;
  session stays valid.
- UAT-601 — SMTP save + test **[LIVE]**; blank password keeps stored value
  (verify by saving other fields, test still passes).
- UAT-602 — DO rotation: update ONE key only → Test connection passes;
  empty submit → 400.
- UAT-603 — AI credit save ($26 test → restore original): tile + forecast
  reflect it; invalid (negative/text) → 400.
- UAT-604 — Budgets: create (custom levels e.g. `30,60,90,150`) → row with
  progress + pace; edit amount/levels; pause (is_active off hides from
  dashboard bar); delete with confirm.
- UAT-605 — Digest: save cadence each option; test-send **[LIVE]** arrives
  with all six sections; disable → no send.
- UAT-606 — Thresholds: create `daily_spend_usd` + `daily_spend_spike`
  thresholds; metrics list contains both new options.
- UAT-607 — Backups: Back up now → row appears; Download → ~200KB file;
  Restore → staged warning → Cancel clears it.
- UAT-608 — Schedule save (weekly/hour) + roundtrip; invalid hour → 400.
- UAT-609 — S3 section renders; Test without creds → clean failure text
  (no network call). **[LIVE]** with creds: test ok, upload on next backup,
  List shows objects, Fetch pulls one locally.
- UAT-610 — Notification log lists entries with sent/failed tags.

## 7. Billing engine (verify via DB/API, no UI needed)

- UAT-700 — `billing_state`: core 0, ai ≈59.18, tax 9, prepaid 10,
  inference 0, payments_json has the Visa entry, breakdown_json parses.
- UAT-701 — `billing_daily` grows ~29 rows/day-max; re-sync is idempotent
  (row count stable across two manual syncs 1 min apart).
- UAT-702 — `model_rates` holds 6 models with input/output/cache legs.
- UAT-703 — Forecast endpoint math spot-check vs §UAT-202.
- UAT-704 — Spike path: covered by `test-spike.mjs` logic (run it pre-UAT).

## 8. Cross-cutting

- UAT-800 — Unauthenticated API access: `GET /billing/summary`,
  `/model-routers`, `/backups` without cookie → 401; `/health`, `/telemetry/*`
  behave per design (public).
- UAT-801 — Path traversal on backup download/restore → 404, no file leak.
- UAT-802 — Server restart mid-session: sessions persist (DB-backed), Masonry
  of intervals resumes (billing sync within 5 min, backup check within 1h).
- UAT-803 — Staged restore full loop (staging env only): stage a backup →
  restart → data matches backup timestamp → marker cleared.

## 9. Automation backlog (unit tests, later)

- `billing-lines.ts`: bucket/model/tokens/rates parsing across all known SKU
  shapes + unknown-SKU fallthrough.
- Threshold + budget evaluation incl. cooldown, rollover, fired-once logic
  (extend `test-spike.mjs` / `test-budget-digest.mjs` patterns).
- Digest builder golden-output test (frozen fixture DB).
- `acceptBackupFile`, `safePath`, `backupDue`, `advance()` date math.
- Harness: node:test (zero new deps) run pre-commit; scripts above are the
  seed corpus.
