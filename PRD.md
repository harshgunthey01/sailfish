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

