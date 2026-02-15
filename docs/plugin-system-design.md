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

MVP uses the existing backend base path:

- `POST /vivd-studio/api/plugins/contact/v1/submit`

Rationale: it’s already routed to the backend by Caddy on both:
- the default server, and
- published-site domain snippets.

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

---

## Routing Options (Decision)

Two viable approaches; MVP can start with (A) and keep (B) as a refinement.

### (A) Same-origin via existing `/vivd-studio/api/*` routing (recommended for MVP)

- Website forms post to `/vivd-studio/api/plugins/...` on the same host.
- Minimal plumbing changes (mostly backend + UI).

### (B) Dedicated plugin path or host (future)

- Cleaner path: `/api/plugins/...` (requires updating Caddy default + snippet generator), or
- Global host: `https://api.vivd.../plugins/...` (requires CORS + domain binding, but can simplify edge deployments).

---

## Phased Delivery Plan

1) Define plugin registry + shared types (manifest, config schemas, IDs).
2) Add DB tables:
   - `project_plugin_instance`
   - plugin-specific tables (start: `contact_form_submission`)
3) Implement backend:
   - public plugin router (REST)
   - management router (tRPC)
4) Implement frontend:
   - “Plugins” UI
   - contact submissions inbox
5) Implement agent integration:
   - ensure plugin instance + return snippet tool/action
   - update agent instructions/recipes
6) Hardening:
   - Redis rate limits
   - captcha option
   - retention policies
   - webhook/email delivery
   - audit log entries for enable/disable/token rotation

---

## Open Decisions

- MVP delivery target:
  - store-only + inbox first (fastest), and/or
  - immediate email/webhook forwarding (depends on provider choice and secret handling).
- Endpoint surface:
  - keep under `/vivd-studio/api/plugins/...` for MVP, or
  - introduce `/api/plugins/...` for cleaner public URLs.

