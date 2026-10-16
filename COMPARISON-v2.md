# Multi-Cloud Price Comparison — v2 Spec

> Status: **design only** (no implementation). Supersedes the AWS/GCP-only
> sketch with verified Vultr, Linode, and OVHcloud sources.
> Guiding frame: list-price comparison is a migration *signal*, not a quote.
> Every approximation is labeled in the product, never buried.

## 1. Data sources (all verified, no scraping)

### 1.1 Inference (per-token) — 3–4 vendors

| Vendor | Endpoint | Auth | Notes |
|---|---|---|---|
| DigitalOcean (own) | Stored `model_rates` + `billing_daily` | Already have | Ground truth: observed, not list |
| AWS Bedrock | Price List Query API, service `AmazonBedrock` | None (public) | Per-model $/1M in/out by region |
| GCP Vertex AI | Cloud Billing Catalog API (`services.skus.list`) | Customer API key | Same shape once fetched |
| OVHcloud AI Endpoints | Order catalog (same mechanism as §1.3) | None + subsidiary | Serverless inference catalog; exact SKU shape TBD at build |

Vultr and Linode sell raw GPU VMs, not serverless inference — they sit out
the per-token comparison (see §1.2).

### 1.2 VMs (list price) — 6 vendors

| Vendor | Endpoint | Auth | Response / notes |
|---|---|---|---|
| DigitalOcean (own) | Droplet sizes + own bills | Already have | Ground truth for the "stay" column |
| AWS EC2 | Price List Query API (`GetProducts` filtered by instanceType/OS/tenancy/location) + Savings Plans dimensions | None (public) | Large responses; filter server-side |
| GCP Compute Engine | Cloud Billing Catalog API | Customer API key | Large; same handling as AWS |
| **Vultr** | `GET https://api.vultr.com/v2/plans` | **None — verified live**: full plan objects returned unauthenticated | Best-structured source of all six: vcpu/ram/disk/bandwidth + monthly/hourly + per-location cost overrides, one small response |
| **Linode** | `GET https://api.linode.com/v4/linode/types` | Customer token (docs: no IAM grants required, authentication still required) | Excellent shape: specs + `price{hourly,monthly}` + per-region `region_prices`, incl. GPU types |
| **OVHcloud** | `GET https://{eu,us}.api.ovh.com/1.0/order/catalog/public/{cloud,vps}?ovhSubsidiary=XX` | None (subsidiary param instead) — verified live | Complete but **>5MB per catalog**: heaviest source, demands the hardest caching. VPS catalog maps closest to small droplets |

### 1.3 Credential surface (delta vs today)

New customer-pasted keys: **Linode token, GCP API key** (Vultr/OVH/AWS need
none). Same Settings pattern as DO tokens: blank = keep, test button per
vendor, secrets in the vault, never displayed back.

## 2. Architecture

### 2.1 Adapters (one per cloud) → one normalized store

Each adapter fetches vendor JSON, filters to what we compare, and writes
canonical rows:

```
cloud_prices(
  vendor TEXT, kind TEXT CHECK (kind IN ('vm','inference')),
  cpu INT NULL, ram_mb INT NULL, model TEXT NULL,
  region TEXT NOT NULL,            -- vendor-native region id
  ondemand_hourly REAL NULL,       -- VMs
  per_1m_in REAL NULL, per_1m_out REAL NULL,   -- inference
  as_of TEXT NOT NULL,
  PRIMARY KEY (vendor, kind, cpu, ram_mb, model, region)
)
```

- Refresh: weekly scheduled pull per vendor (staggered days to spread load);
  Vultr/Linode are small enough to refresh inline, AWS/GCP/OVH stream-parse
  and store normalized rows only — never the raw megabytes.
- Every figure carries `as_of`; the UI always shows price vintage.

### 2.2 Region mapping (checked in, disclosed in UI)

Nearest-match table, e.g. DO `blr1` → AWS `ap-south-1` (Mumbai) →
Vultr `blr` → Linode `in-maa` → OVH `GRA` (Gravelines, EU) / `BHS`… These
are *nearest*, never identical cities. The report labels every row with the
mapping used. New regions are data rows, not code changes.

### 2.3 Discount engine (customer-defined, like budget alerts)

Effective price = list × (1 − discount), per cloud, all inputs visible:

- DO negotiated % (manual, same pattern as the credit field).
- AWS: Savings Plan picker (none / 1yr / 3yr × no-upfront / partial / full)
  and/or flat %.
- GCP: committed-use % (resource-based or spend-based, single field v1).
- Vultr / Linode / OVH: flat negotiated % (neither publishes plan
  commitments for these sizes; revisit if that changes).

### 2.4 Report

Per-resource verdict table at the customer's *current volume* (droplet sizes
from the Infrastructure page; token volumes from `billing_daily`):
cheapest cloud per row + delta $/mo, region mapping shown, egress/support
explicitly excluded (stated on the report, not footnoted away). CSV export +
print-friendly view (print CSS, no PDF library).

## 3. Known fuzz (stated in-product, not hidden)

- **VM similarity is by spec sheet** (vCPU/RAM/disk): burstable (AWS T-series
  credits) vs fixed vCPU (DO) vs shared vs dedicated (Linode classes) differ
  in reality — the report says so per row class.
- **Model parity is approximate**: same weights ≠ same served price/perf;
  Bedrock/Vertex availability is per-region; different tokenizers make
  per-1M-token math approximate across vendors. Compare families, flag
  mismatches, never auto-recommend migration on inference alone.
- **Taxes, egress, support plans excluded v1** — printed on every report.

## 4. Phasing

1. **Inference 3-way** — DO observed rates (stored) vs Bedrock vs Vertex.
   Value today, against the $59/mo AI spend and zero droplets.
2. **VM 6-way catalog** — adapters + normalized store + region table. Dormant
   UI until droplets exist (same honest-empty pattern as Infrastructure v1).
3. **Discounts + report** — engine is small once normalized prices exist; the
   report UI is the bulk. OVH inference ("TBD" above) resolves here if its
   catalog exposes usable AI SKUs.
