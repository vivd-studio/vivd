# Website Plugin System Design (MVP: Contact Forms)

Date: 2026-02-15  
Owner: backend + frontend + studio  
Status: plan (no implementation in this doc)

This document captures a pragmatic, extensible plugin architecture for Vivd-built websites, starting with a **Contact Forms** plugin.

---

## Goals

- Add reusable functionality to published websites (Contact forms now; later: newsletter, booking, etc.).
- Fit the current Vivd architecture:
  - central control-plane backend + central Postgres DB
  - orgs/projects/versions
  - studio machines (Fly) for editing/building
  - object storage as source-of-truth for project artifacts
  - Caddy for serving published sites
- Ensure plugin features work **even when no Studio machine is running**.
- Keep it **pragmatic** (low operational overhead), but **extendable** and robust.
- Ensure the **AI agent can implement everything**: enable plugin, insert snippet(s), configure, and verify.

## Non-goals (MVP)

- Arbitrary third‑party plugin code execution (marketplace / install-anything).
- Per-plugin compute isolation or custom runtime sandboxes.
- Interactive conflict-resolution UI for complex workflows (e.g. booking calendars) in v1.

---

## Recommendation (High-level)

Implement a **first-party plugin platform** inside the existing **control-plane backend** (`packages/backend`):

1) **Public plugin endpoints** for website visitors  
   - designed for plain HTML usage (e.g. `<form action="...">`)
   - authenticated via per-site access tokens (like Web3Forms)
2) **Authenticated management endpoints** (tRPC) for Studio/control-plane UI  
   - enable/disable plugins per project
   - configure plugin settings
   - view/export operational data (e.g. contact submissions inbox)

Start with **built-in plugins only** (modules shipped in this repo). That gives a “plugin system” without introducing third-party execution risks.

---

## Where Plugin Data Lives

### Website code and assets

- Unchanged: stored and served via existing object-storage → publish → Caddy flow.

### Plugin configuration (website/customer specific)

- **Central Postgres**, scoped by `organizationId` + `projectSlug`.
- Examples: recipient emails, redirect URL allowlist, webhook URLs, retention settings.

### Plugin operational data (submissions, bookings, etc.)

- **Central Postgres**, in plugin-specific tables (multi-tenant columns required).
- Use object storage only for large payloads/attachments (future).

### Website repository contents

- Only **public identifiers** needed for runtime calls (e.g. a `token`).
- Do **not** embed secrets (SMTP creds, API keys) in the website code.

---

## Core Concepts

### Plugin registry (code-defined)

Maintain an in-repo registry of available plugins:

- `pluginId` (stable string, e.g. `contact_form`)
- name/description/category
- config schema (zod) + defaults
- public endpoints exposed by the plugin
- “agent recipe” (instructions + templates the agent can apply)

### Plugin instance (per project)

Enabling a plugin creates a **plugin instance** bound to a project:

- `(organizationId, projectSlug, pluginId)` unique
- `status`: `enabled | disabled`
- `configJson`: validated plugin configuration
- `publicToken`: access token used from the website
- timestamps

Token recommendation:

- `token = <instanceId>.<randomSecret>`
  - store a hash of `<randomSecret>`
  - allows rotation and cheap lookup by `instanceId`

---

## Public Plugin API (MVP: Contact Forms)

### Endpoint shape

MVP uses a dedicated public API host:

- `POST https://api.vivd.studio/plugins/contact/v1/submit`

Rationale:
- clean separation between public website plugin traffic and internal control-plane APIs
- internal authenticated APIs remain under `/vivd-studio/api/trpc/...`
- host can be overridden per environment via `VIVD_PUBLIC_PLUGIN_API_BASE_URL`

### Supported request types

- `application/x-www-form-urlencoded` (plain HTML `<form>`)
- `multipart/form-data` (future: attachments)
- `application/json` (fetch-based forms)

### Request fields (MVP)

- `token` (required)
- typical fields:
  - `name`
  - `email`
  - `message`
- optional system fields:
  - `_redirect` (optional; must be validated to prevent open redirects)
  - `_subject` (optional; sanitized/length-limited)
  - `_honeypot` (optional; must be empty)

### Response behavior

- HTML form:
  - `303` redirect to validated `_redirect`, else redirect back with a default success indicator
- JSON:
  - `{ ok: true }` or `{ ok: false, error: { code, message } }`

### Abuse prevention / robustness

Minimum set for v1:

- Token verification (instance exists + secret hash matches).
- Origin validation:
  - validate `Origin` or `Referer` host against allowlisted hosts for the project:
    - published domains (`published_site.domain`)
    - tenant host domain(s) (domain registry)
    - localhost / local dev allowlist
- Rate limiting:
  - per token + per IP (MVP: in-memory; plan Redis later).
- Spam controls:
  - honeypot + minimum submit time + basic heuristics.

Storage behavior:

- Always store the submission in DB (inbox is the baseline UX).
- Optional follow-ups: email delivery, webhooks, integrations.

## Email Delivery Abstraction (Required)

For contact-form and future plugin notifications, use a provider-agnostic email layer so provider swaps are low-risk.

- Plugin code must call a backend `EmailDeliveryService` interface, not provider SDKs directly.
- Implement provider adapters behind that interface (for example: SES, SMTP, Resend, Postmark), selected via config/env.
- Keep plugin DB schema provider-neutral (canonical recipient/sender/template/payload fields); do not persist provider-specific request shapes.
- Keep provider-specific secrets/config outside plugin instance payloads (backend secret/config boundary only).
- Add adapter contract tests so provider changes do not require plugin logic rewrites.
- Treat provider choice as an implementation detail: switching provider should be an adapter/config change, not a plugin API or schema migration.

---

## Management API (Control Plane / Studio)

Expose tRPC procedures for:

- listing available plugins (registry)
- enabling/disabling plugins per project
- updating plugin config
- rotating tokens
- viewing operational data (e.g. contact submissions inbox)

### UI (MVP)

Add a “Plugins” section per project:

- plugin catalog
- enable/disable “Contact Forms”
- show a copy/paste snippet (plain HTML + Astro variants)
- “Inbox” tab for submissions (list + detail + export)

---

## AI Agent Requirements (Must-Have)

The agent should be able to implement plugin features for a customer without manual steps.

### Agent recipe per plugin

Each plugin ships:

- snippets/templates (static HTML + Astro)
- recommended placements (contact page, footer, etc.)
- config fields and safe defaults
- checks/detection (to verify installation + ensure idempotent edits)

### Agent-callable enablement/config

Provide an agent-callable operation (Studio connected-mode or backend) that:

- enables/ensures a plugin instance exists for a project, and returns:
  - `token`
  - recommended snippet(s)
  - any config defaults

Optional: persist discovery info into the project:

- `.vivd/plugins.json` (enabled plugins + instance ids + metadata)
- `.vivd/plugins.md` (human/agent-readable usage instructions)

This makes plugin installs repeatable and easy for the agent to reason about.

### Agent + UI Exposure (Recommendation)

**Source of truth stays in the control-plane DB.** The Studio workspace should not be treated as the authoritative place for plugin configuration/state.

#### UI (where plugin enable/config lives)

- Add a **Plugins** section to the **control-plane UI** (`packages/frontend`) scoped to a project.
  - Rationale: plugin runtime must work even when no studio machine is running, so enable/disable/config should not depend on studio.
- The UI flow for “Contact Forms” MVP:
  1) Enable plugin
  2) Configure recipient(s) / redirect allowlist / basic spam controls
  3) Copy snippet(s) (HTML + optional Astro variant)
  4) (MVP+) Inbox tab for submissions

#### Agent (how it learns plugin state)

- Provide an authenticated backend procedure like `plugins.ensureInstanceAndGetSnippet(...)` that:
  - ensures the plugin instance exists for the project
  - returns `publicToken` + recommended snippet(s) + minimal “recipe” metadata
- The agent should prefer calling this procedure over relying on project files, so it always sees the latest configuration.

#### Agent tool exposure (OpenCode custom tools)

For Vivd-specific operations (plugin enablement, snippet generation, inbox access, etc.), ship a small set of **OpenCode custom tools** into the Studio runtime (e.g. `vivd_plugins_*`).

- Status (2026-02-21): this path is validated in local connected-mode with real plugin tools (`vivd_plugins_catalog`, `vivd_plugins_contact_info`) end-to-end.
- OpenCode loads custom tools from:
  - per-project `.opencode/tools/`, or
  - global `~/.config/opencode/tools/` (recommended for Studio-provisioned tools)
- Prefer provisioning the tools in the Studio runtime (global tool dir) so they’re available for every project **without writing into the bucket-synced source**.
- Tools can authenticate back to the control plane using `MAIN_BACKEND_URL + SESSION_TOKEN`, and should scope requests with `VIVD_TENANT_ID` / `VIVD_PROJECT_SLUG`.

#### Project “bridge files” (`.vivd/plugins.json`) — optional and **derived**

If we materialize plugin info in the project workspace, treat it as a **read-only cache** for humans/agents:

- Must not contain secrets (SMTP creds, API keys, webhook signing secrets, etc.).
  - It may contain **public tokens** that are already embedded in website HTML (e.g. contact form token).
- Suggested shape (example):
  ```json
  {
    "schemaVersion": 1,
    "generatedAt": "2026-02-20T12:00:00.000Z",
    "project": { "organizationId": "org_...", "slug": "my-site" },
    "plugins": [
      {
        "pluginId": "contact_form",
        "instanceId": "ppi_...",
        "status": "enabled",
        "public": { "token": "ppi_....<random>" }
      }
    ]
  }
  ```
- Studio/bucket sync caveat:
  - Studio source sync is **exact** (local provider deletes the remote prefix; Fly uses `aws s3 sync --delete`).
  - Therefore **the backend must not “inject” files directly into the source bucket while a studio machine is running** (they can be deleted/overwritten by the next sync).
- Practical approach if we want the bridge file:
  - Prefer generating/updating `.vivd/plugins.json` **from inside the studio machine** (single-writer), by fetching current plugin state from the backend using `MAIN_BACKEND_URL + SESSION_TOKEN`, then letting the normal studio→bucket sync persist it.
  - If no studio machine is running, optionally write the cache into the bucket so it will be present on next hydrate (but still treat it as derived).

---

## Routing Decision (Locked)

- Public plugin runtime traffic uses dedicated host `https://api.vivd.studio/plugins/...` (or environment override).
- Internal authenticated management traffic stays on existing control-plane routes (`/vivd-studio/api/trpc/...`).
- Local/self-host deployments can point `VIVD_PUBLIC_PLUGIN_API_BASE_URL` at their own API host while keeping the same plugin contract.

---

## MVP Scope Decisions (Locked for Start)

- Scope by **project** (not per-environment) for MVP to keep landing-page workflows simple.
  - If preview/prod divergence becomes necessary later, add an `environment` dimension as an additive schema change.
- Contact form baseline is **store + inbox** first; email/webhook forwarding are follow-up integrations.
- Agent integration starts on existing OpenCode custom tools (`vivd_plugins_*`) in Studio runtime.
- Keep public submit routing on dedicated external API host (`https://api.vivd.studio/plugins/...`) for MVP.

---

## Phased Delivery Plan (Execution-Ready)

### Phase 0 — Foundation + Tooling (start now)

1) Define plugin contracts and registry:
   - shared `pluginId`, manifest, config schema contracts
   - backend registry with first built-in plugin: `contact_form`
2) Add DB tables + indexes:
   - `project_plugin_instance` (`organizationId + projectSlug + pluginId` unique)
   - `contact_form_submission` (tenant/project/plugin-instance scoped)
3) Add provider-agnostic email contract:
   - `EmailDeliveryService` interface + adapter boundary
   - initial non-delivery/dev adapter (or provider adapter if chosen)
4) Add first real custom tools in Studio:
   - `vivd_plugins_catalog`
   - `vivd_plugins_contact_info`

### Phase 1 — Contact Form Runtime MVP

1) Public submit endpoint:
   - `POST https://api.vivd.studio/plugins/contact/v1/submit`
   - token + origin checks + honeypot + minimal rate limits
2) Management tRPC endpoints:
   - list available plugins
   - enable/disable + config update + token rotation
3) Submission persistence + read APIs:
   - write every valid submission
   - list/detail/export endpoints for inbox UX

### Phase 2 — Control-Plane UX + Agent Recipe

1) Project “Plugins” UI:
   - enable/configure Contact Form
   - show generated snippet(s)
   - basic inbox list/detail
2) Agent recipe updates:
   - ensure-instance + snippet insertion flow
   - idempotent install checks
3) Optional derived cache:
   - `.vivd/plugins.json` generation from Studio runtime (not source-of-truth)

### Phase 3 — Hardening + Integrations

- Redis-backed rate limiting
- captcha option
- retention/purge policies
- first production email provider adapter behind `EmailDeliveryService`
- webhook delivery path
- audit logs for enable/disable/config/token operations

---

## Custom Tools vs MCP Server (Now vs Later)

- **Now:** use Studio-provisioned OpenCode custom tools as the fast path (`~/.config/opencode/tools/`).
- **Later (optional):** add a central `vivd-mcp` service in control-plane backend if non-Studio agents need the same capabilities.
- Rule: keep plugin business logic in backend services; tools/MCP are thin transport layers on top.

---

## Open Decisions

- Initial production email provider and cutover strategy between providers (plugin-facing abstraction is required either way).
- Timing for introducing central `vivd-mcp` beyond Studio custom tools.
