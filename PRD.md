# DO-Inference Billing & Router Dashboard PRD

> Extracted from PDF. Pages: 7

Product Requirements Document
DO-Inference Billing & Router Dashboard
System Specification and AI Implementation Blueprint
1. Overview and Objectives
This document outlines the requirements for a custom, PocketBase-powered dashboard designed to
manage DigitalOcean Serverless Inference usage alongside core compute costs. The application serves
as a single source of truth for granular telemetry and billing data while providing a graphical interface for
tasks currently restricted to the Command Line Interface (CLI). Built with a mobile-first approach using
the IBM Carbon Design System, the dashboard abstracts complex CLI commands into an intuitive,
touch-friendly UI for rapid cost optimization and model management.
Primary Goals
● Unified Cost Visibility: Ingest and visualize real-time token telemetry alongside dual account
balances (Core Compute and prepaid AI Inference) from DigitalOcean's APIs.
● Visual Router Configuration: Provide a mobile-friendly UI to define rules for the DigitalOcean
Inference Router, optimizing prompt routing for cost and latency without touching the CLI.
● Model Management: Replicate CLI-exclusive capabilities (adding/removing models) via a
graphical interface.
● Streamlined Deployment: Ensure any user can easily deploy the application through a guided
initial setup wizard for critical configurations.
● AI-Ready Architecture: Provide clear, structured schema and Carbon-specific component
definitions so an AI coding assistant can generate the PocketBase backend and React frontend
seamlessly.

-- 1 of 7 --

2. Core Features and Functional Requirements
2.1. Initial Setup Wizard (Onboarding)
To facilitate easy deployment by third-party users, the application must launch into a forced setup
wizard on its first boot before the main dashboard becomes accessible.
● Step 1: Admin Account Creation
○ Securely create the root PocketBase administrator account.
● Step 2: SMTP Configuration
○ Input fields for SMTP Host, Port, Username, Password, "From" address, as well as
webhook configuration for Slack (channels or Slackbot DMs) and Google Chat, alongside
custom billing threshold triggers.
○ Must include a Send Test Email action button.
● Step 3: DigitalOcean Authentication
○ Input field for standard OAuth Token (for Control-Plane billing endpoints).
○ Input field for $MODEL_ACCESS_KEY (for Inference APIs).
○ Must include a Test Connection button that pings /v2/customers/my/balance and
/v1/models to verify credentials before completing setup.
2.2. Telemetry and Dual Billing Aggregation
The dashboard polls two distinct billing endpoints to unify DigitalOcean's billing structures:
● Dual Balance Tracking
○ Core Compute (Accrued): Pull from /v2/customers/my/balance
(month_to_date_balance) and open invoices for Droplets, Kubernetes, and Volumes.
○ AI Inference (Prepaid): Pull from /v2/customers/my/prepayment_config to track
the separate Inference and Agents balance, tracking spend limit and
prepay_threshold.
● Real-Time Token Tracking
○ Parse and store usage objects (prompt, completion, and total tokens) from the
/v1/chat/completions and /v1/responses endpoints.
● Automation Hooks
○ Expose webhooks and configure direct integrations with Slack (channel or Slackbot DM)
and Google Chat. Automated notifications trigger instantly when custom user-defined
billing thresholds or spend limits are breached.

-- 2 of 7 --

2.3. Inference Router Management
● Rule Builder UI: A visual interface to define and order routing rules (e.g., routing complex
reasoning to llama3.3-70b-instruct).
● Cost vs. Latency Optimization: Controls to prioritize cost savings or low latency for specific
routing paths.
● Version Control: Save historical snapshots of router configurations in PocketBase to allow
instant rollbacks.
2.4. Model Management (CLI Abstraction)
● Graphical Model Registry: A unified view of all active models, replacing the need to query the
CLI for available endpoints.
● Add/Remove Models: UI actions that trigger the backend to execute required CLI commands
(or undocumented API equivalents) to provision or spin down specific models.
3. UI/UX & Design System (IBM Carbon)
The application must be built mobile-first using the IBM Carbon Design System, leveraging its fluid
4-column mobile grid, IBM Plex typography, and strict design tokens.
3.1. Theming and Layout
● Dark/Light Mode: Implement the Carbon <Theme> component wrapper. Bind a global toggle to
switch between g10 (Light mode, cool gray) and g100 (Dark mode, deep black) themes.
● Mobile Grid: Utilize Carbon's <Grid> and <Column> components. On mobile viewports,
components must span all 4 columns (100% width) and stack vertically.
● Navigation: Use the Carbon <Header> component with a mobile-friendly <SideNav> that
collapses into a hamburger menu to maximize screen real estate for data.
3.2. Visual Architecture & Dashboard Layout
Section 	UI Component 	Data Source / Action 	Visual Behavior
Header Stats 	ClickableTile / GaugeChart 	/v2/customers/my/balan… 	AI Inference tile gauge shifts to
support-error token when
balance approaches threshold.

-- 3 of 7 --

Section 	UI Component 	Data Source / Action 	Visual Behavior
Token Burn Rate 	<AreaChart>
(@carbon/charts-react)
PocketBase telemetry_logs 	Visualizes 7-day token
consumption with smooth gradient
fills under dark mode.
Cost Distribution 	<DonutChart>
(@carbon/charts-react)
PocketBase telemetry_logs 	Breakdown of spend grouped by
active AI model IDs.
Router Config 	<Accordion> + <Slider> 	PocketBase router_rules 	Rules stack vertically on mobile;
Sliders adjust weight between
"Cost" and "Latency".
Model Registry 	<StructuredList> + <Toggle> 	PocketBase managed_models 	Toggling switches triggers
background CLI provisioning with
<InlineLoading> feedback.
3.3. Mobile Component Mappings for CLI Tasks
● Setup Wizard UI: Utilize Carbon's <ProgressIndicator> component to guide the user
through onboarding.
● Model Toggles: Vertical <StructuredList> containing <Toggle> controls paired with
<InlineLoading> states.
● Router Controls: Embedded <Dropdown> elements for model selection and <Slider>
elements for priority weight.
● Terminal Output Fallback: Hidden Carbon <Modal> triggered on CLI errors, rendering
formatted stderr/stdout inside a <CodeSnippet> container.

-- 4 of 7 --

4. Technical Architecture (PocketBase)
4.1. Database Schema
Collection: telemetry_logs
Field Name 	Type 	Options / Constraints 	Description
id 	System ID 	Primary Key 	Unique log record identifier
timestamp 	DateTime 	Required, Index 	Epoch timestamp of completion
event
model_id 	Text 	Required 	Model identifier string (e.g.,
llama3.3-70b)
prompt_tokens 	Number 	Integer 	Input token count
completion_tokens 	Number 	Integer 	Output token count
total_cost_usd 	Number 	Float, Precision 6 	Calculated USD cost for request
Collection: billing_state
Field Name 	Type 	Options / Constraints 	Description
id 	System ID 	Primary Key 	State record ID
compute_balance 	Number 	Float 	Accrued core compute
month-to-date balance
inference_balance 	Number 	Float 	Remaining balance in prepaid AI
pool
is_blocked 	Bool 	Default: false 	Circuit breaker state if threshold
breached
last_synced 	DateTime 	Required 	Last successful polling sync time

-- 5 of 7 --

Collection: router_rules
Field Name 	Type 	Options / Constraints 	Description
id 	System ID 	Primary Key 	Rule ID
rule_name 	Text 	Required 	Non-unique display label
target_model 	Text 	Required 	Destination model mapping
priority_metric 	Select 	Options: "Cost", "Latency" 	Optimization bias flag
is_active 	Bool 	Default: true 	Rule enforcement status
Collection: managed_models
Field Name 	Type 	Options / Constraints 	Description
id 	System ID 	Primary Key 	Record ID
model_name 	Text 	Unique, Required 	Official model descriptor string
status 	Select 	Options: "Active",
"Deploying", "Removed"
Lifecycle state of model resource
Collection: app_settings (Singleton)
Field Name 	Type 	Options / Constraints 	Description
id 	System ID 	Primary Key 	Singleton Record ID
setup_complete 	Bool 	Default: false 	Controls initial onboarding redirect
smtp_configured 	Bool 	Default: false 	Tracks notification readiness
do_auth_configured 	Bool 	Default: false 	Tracks API credential status
4.2. Integration & Security
● Credential Vault: Securely store $MODEL_ACCESS_KEY and standard OAuth Tokens in
PocketBase environment variables or inside an admin-only encrypted collection.

-- 6 of 7 --

● Background Polling: Utilize PocketBase Go or JS hooks to periodically poll DigitalOcean billing
APIs and execute local CLI wrappers asynchronously.
5. AI Code Generation Instructions
When providing this document to an AI coding assistant, enforce the following instructions:
1. Backend Generation:
○ Initialize a PocketBase instance strictly adhering to the schema in Section 4.1.
○ Middleware must redirect all unauthenticated or non-setup traffic to the setup route
until app_settings.setup_complete evaluates to true.
○ Construct custom Go/JS route handlers acting as proxies for DigitalOcean's /v1/
inference and /v2/ control-plane endpoints.
2. Frontend Generation:
○ Implement the React UI exclusively utilizing carbon-components-react and
@carbon/charts-react.
○ Set the root <Theme> provider default theme to g100 (Dark Mode).
○ Structure onboarding via a multi-step <ProgressIndicator> flow.
3. Layout & Responsiveness:
○ Strictly forbid arbitrary CSS media queries for layout structuring.
○ Enforce grid responsiveness strictly via Carbon's standard <Grid> and <Column>
viewport property bindings (sm={4}, md={8}, lg={16}).

-- 7 of 7 --

6. Implementation Amendments (as-built)
Sections 1–5 above are the extracted source requirements, preserved verbatim.
This section records what was actually built where it differs or goes further.

6.1. Backend: Node + SQLite instead of PocketBase (§4)
- Single-process Hono monolith on `node:sqlite` (Node 22+ built-in, zero native
  deps); no PocketBase. Schema intent from §4.1 is preserved in
  `server/src/db/schema.ts` with incremental `ALTER TABLE` migrations for existing DBs.
- Credential vault: AES-256-GCM `vault.json` keyed off `/data/.machine-secret`;
  no plaintext secrets in SQLite. Admin auth is scrypt + httpOnly session cookies.
- Telemetry ingest is HMAC-authed: `Authorization: Bearer
  HMAC-SHA256("sailfish-ingest-v1", model_access_key)`.

6.2. Billing: per-product breakdown, not just two balances (§2.2)
- The sync polls `/balance` + prepayment endpoints AND the Billing Insights API
  (`/v2/billing/{urn}/insights/{start}/{end}`), classifying each SKU line:
  `1-AI-*` → GenAI usage, `1-DO-AI*` → AI credit purchases, `1-DO-ADJMT-00TAX` →
  tax, negative amounts → credits, everything else → core compute.
- `billing_state` gains: `core_compute_mtd`, `ai_usage_mtd`, `tax_mtd`,
  `account_balance`, `prepaid_amount`, `payments_json` (from
  `/v2/customers/my/billing_history`), `breakdown_json`; `billing_history` gains
  the MTD columns. Rationale: the account-wide `month_to_date_balance` was once
  mislabelled "Core Compute" when it was actually GST — the breakdown makes each
  bucket auditable.
- Prepayment parsing handles the live nested shape
  (`{config: {prepay_amount…}, status: {balance…}}`); remaining = `status.balance`
  with `prepaid − used` as fallback.
- Known platform gap: DO exposes NO public API for the *live* AI-credit remaining
  (`/credits` 404s, `/balance` is a cached snapshot, prepayment endpoints cover
  only the prepaid plan). The dashboard shows verifiable figures (payments ledger,
  usage MTD) and points at DO's billing page for the live remainder.

6.3. Router: live DO routers, not just local rules (§2.3)
- Full CRUD proxy at `/api/v1/model-routers` → DO `/v2/gen-ai/models/routers`
  (policies, fallback models, cheapest/fastest selection). Router routes need only
  the OAuth token, not the model key. Local `router_rules` remain as an offline
  advisor section.
- DO-managed routers (e.g. `inference-router`, "DigitalOcean managed Inference
  Router") expose no config and DO rejects edits/deletes with 403: the UI tags
  them and disables Edit/Delete. The proxy forwards DO's real HTTP status
  instead of a blanket 502.
- Invocation: routers are addressed as `model: "router:<name>"` on
  `https://inference.do-ai.run/v1/chat/completions`.

6.4. Telemetry pricing reflects real rates (§2.2, §3.2)
- The bundled `PRICING` table uses real DO per-1M rates taken from insights
  `@ $X/thousand` annotations (deepseek-4-flash, deepseek-v4.1-flash,
  qwen3.8-max, glm-5.3/flash, gpt-oss-120b).
- `server/scripts/backfill-telemetry.mjs` (idempotent) seeds `telemetry_hourly`
  from stored insights lines at DO's own dollar amounts.
- Donut values use 6-decimal precision so sub-cent costs don't render as 0.

6.5. Settings replicates onboarding (§2.1)
- Every wizard step is editable post-setup: admin password rotation
  (`POST /setup/password`, current password required; email immutable),
  SMTP/webhook read + update (`GET`/`POST /setup/smtp`, blank password = keep),
  per-credential DO rotation (`POST /setup/do` accepts partial updates),
  plus the wizard's test-email / test-connection actions. Secrets are never
  displayed back; status tags confirm what is stored.

6.6. Theming correction (§3.1)
- Dark/light mode applies `cds--g100` / `cds--g10` classes to `<html>` so the
  whole page themes, not just the React tree.

6.7. Backups & sizing
- No size tier is prescribed: the early "$4 droplet" framing was hypothetical.
  `docker-compose.yml` carries conservative resource defaults; raise them on
  larger hosts. `deploy/setup-vm.sh` provisions swap as good hygiene on any
  small VM.
- Backup/restore is Node-native SQLite, not PocketBase hooks (there is no
  PocketBase in this stack — §6.1): `VACUUM INTO` snapshots to
  `data/backups/`, newest 7 kept, daily schedule + boot-when-stale, staged
  restores applied pre-open with a safety snapshot, all behind the admin
  session in Settings.

