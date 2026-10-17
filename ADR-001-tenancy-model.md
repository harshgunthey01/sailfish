# ADR-001 — Tenancy model: silo-SQLite, not pool-Postgres

**Status:** Accepted (design phase, no code yet)
**Date:** 2026-10-17
**Context:** Sailfish is single-tenant today (one SQLite file, one admin, one vault). Moving to multi-tenant SaaS requires choosing a data-isolation shape before any tenancy code is written.

## Options

### A — Pool (shared Postgres, `tenant_id` on every row)
- Classic SaaS shape; scales furthest; one DB to operate.
- Cost: Postgres migration, RLS on every table, a cross-tenant-leak test suite,
  and a permanent "did I add tenant_id to this new query?" tax on every feature.
  One missing predicate = a data breach. Row-level bugs are silent until audit.

### B — Silo (one SQLite file per tenant)
- Matches the existing stack exactly: one file = one tenant. Isolation is
  structural, not convention. Per-tenant backup/restore/export/erasure is
  file operations (we already built all of them). Per-tenant cost attribution
  is trivial (one file = one tenant's bill of materials).
- Cost: more files to back up and replicate; a coordination layer for
  cross-tenant admin views; SQLite write throughput caps (~tens of writes/s
  per file, which is fine at our scale for a long time).

### C — Shard by cohort (later optimization)
- Only when silo strains. Not a day-one decision.

## Decision

**B — Silo-SQLite.** Pool-Postgres is the right shape for a company already
on Postgres with a DBA; for a small team shipping a FinOps app, it trades the
one problem we have (file count) for the one problem we can't afford
(cross-tenant leaks). Silo keeps the blast radius of any bug inside one
tenant and makes GDPR erasure a `rm`, not a migration.

## Consequences

- **Stack stays Node + Hono + SQLite** (no Postgres, no ORM). TurboSQL-style
  per-tenant file layout: `data/tenants/<tenant_id>/sailfish.db` (or a tenant
  volume in Docker). Litestream replicates each file.
- **Vault becomes envelope encryption.** The single machine-secret is replaced
  by per-tenant DEKs wrapped by a KMS master key (DO KMS, or age/sops
  self-managed). A database-file leak no longer yields DO tokens — this is
  the single most important security change and is a Phase-A deliverable, not
  a nice-to-have.
- **Cross-tenant CI gate:** a test that boots two tenants and asserts neither
  can read the other's data. Cheap, permanent, non-negotiable.
- **Postgres remains a later option**, triggered by a concrete signal:
  write throughput on a single tenant file, backup fan-out cost, or a
  compliance ask that needs a managed DB. Not preemptively.
- **Per-tenant quotas from day one** (max routers/models/thresholds/poll
  rate) — one tenant's 500-router account must not starve the rest, and DO's
  rate limits are shared across our pollers on tenants' behalf.
- **Migration path off silo, if ever:** export each SQLite file to Postgres
  via a one-off script; the schema is already relational and migration-free.

## Rejected alternative

Pool-Postgres was rejected on risk, not capability: the leak surface is
convention-based, the migration cost is real, and silo loses nothing we
actually need at our scale. Revisit if a tenant exceeds ~10k writes/s or
needs managed-DB compliance.
