# Sailfish SaaS — Phase A Spec (tenancy in code)

> Status: **design only** (no implementation). Depends on ADR-001 (silo-SQLite).
> Phase A = the minimum code changes that turn the single-tenant app into a
> multi-tenant one. Phase B (serving hardening) and C (production posture) follow.

## 0. Ground rules

- **No tenant_id on rows.** Silo means the tenant is the file. The cross-tenant
  leak class is eliminated by construction, not by convention.
- **Per-tenant data lives under `data/tenants/<tenant_id>/`** (SQLite file +
  vault + backups). The bootstrap tenant (today's) migrates to this layout on
  first SaaS boot, one-time.
- **Everything else stays the same.** Schema per tenant = today's schema.
  Endpoints, UI, sync loops are unchanged; they gain a tenant context.

## 1. Tenant context plumbing

- `tenantMiddleware`: resolve tenant from subdomain (`acme.sailfish.app`) →
  `tenant_id`. Every protected route handler runs with `c.get("tenant")`.
- `DATA_DIR` becomes `data/tenants/<tenant_id>/`. `initDb`, `Vault`, and
  `backupDir` all take a tenant-scoped path. The scheduler's per-tenant loops
  are keyed by tenant_id.
- Session cookie carries `tenant_id`; a session is valid only for its tenant.
  Cross-tenant session reuse is impossible by construction.

## 2. Signup & onboarding

- `POST /signup {email, password, workspace_name}`: validate, create tenant
  row, create directory + DB from schema template, create admin, issue session.
- Email verification before DO credentials accepted: `verify_email_token` table
  (single-use, 24h), reuses the reset-token pattern from password recovery.
- Onboarding wizard (unchanged): runs per tenant, writes to that tenant's DB.
- Trial clock: `tenants.trial_ends_at`; `setup_complete` already gates the UI,
  add `trial_active` for billing enforcement.

## 3. Tenant provisioning (automated, no human step)

1. Signup → create `tenants` row (id, name, email, created_at, trial_ends_at).
2. Create `data/tenants/<id>/` directory.
3. Copy schema template → `sailfish.db` (initDb handles this).
4. Create vault (`vault.json` + `.machine-secret`).
5. Create admin row + session.
6. Redirect to onboarding.

**Failure handling:** if any step fails, delete the tenant row + directory
(rollback). No partial tenants.

## 4. Envelope encryption (the security deliverable)

- Replace the single machine-secret with per-tenant DEKs wrapped by a KMS
  master key. Options: DO KMS (preferred), or age/sops self-managed for
  self-hosters.
- `Vault` constructor takes `(dataDir, kmsClient, tenantId)`. DEK generated
  on tenant creation, wrapped, stored alongside `vault.json`.
- A database-file leak yields ciphertext only — no DO tokens.

## 5. Quotas from day one

- `tenants` table: `max_routers`, `max_models`, `max_thresholds`, `poll_rate_limit`.
- Enforced in route handlers (429 on breach). Defaults: 5 routers, 20 models,
  10 thresholds, 5-min poll.
- Quota check runs before any DO API call — prevents rate-limit starvation.

## 6. Your own billing (Stripe)

- Trials: 14 days, no card required.
- Tiers: Starter ($X/mo, 1 user, 5 routers), Pro ($Y/mo, 1 user, unlimited
  routers + agents), Team (later).
- Webhooks: `invoice.payment_succeeded` (extend trial → active),
  `invoice.payment_failed` (grace period → read-only), `customer.subscription.deleted`
  (suspend + 30-day data retention).
- Metering: seats (1 in v1) + tracked-spend bands (soft cap, advisory).

## 7. Serving model

- Split web (stateless, N replicas) from workers (per-tenant polling, concurrency
  caps). The scheduler gains a tenant queue; one slow DO response never delays
  others.
- Per-tenant backoff: if a tenant's sync fails 3×, back off to 30 min and
  surface in the health tile.
- Litestream replication per tenant file for durability.

## 8. Cross-tenant CI gate (non-negotiable)

- Test: boot two tenants, assert neither can read the other's data via any
  endpoint. Run on every commit. Cheap, permanent.

## Effort

- Phase A: 4–6 weeks (KMS envelope = half).
- Phase B (serving hardening): 3–4 weeks.
- Phase C (production posture): 2–3 weeks.
- Plus ~30% for Stripe edge cases.

## Open questions

1. KMS: DO KMS or self-managed age/sops for self-hosters?
2. Subdomain strategy: `acme.sailfish.app` vs path-based `/t/acme/`?
3. Trial length: 14 days vs 30?
4. Data residency: which DO regions at launch?
