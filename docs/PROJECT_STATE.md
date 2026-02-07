# Vivd Project State & Implementation Roadmap

> **Goal:** Transform Vivd into a multi-tenant SaaS platform with a standalone studio (S3/R2-in / S3/R2-out).

This document tracks the current state of development and serves as the canonical implementation plan. Check off items as they are completed.

---

## Guiding Principles

- **Object storage as IO:** Studio machines hydrate a workspace from object storage (Cloudflare R2 via S3 API) and sync changes back (periodic + on shutdown).
- **Studio can run standalone:** The studio can run standalone against a local workspace directory; full self-hosted stack parity is best-effort only.
- **Isolation for safety:** The OpenCode agent can run shell commands and access the filesystem, so editing cannot be safely multi-tenant on one shared machine without heavy sandboxing. For SaaS, run studio as isolated machines (e.g. Fly.io Machines).
- **Control plane vs studio:** The control plane owns auth, orgs, limits, project metadata, object storage, publishing, and orchestration. The studio machine owns the working copy, preview/devserver, and editing UX.
- **Fast view-only preview:** Viewing a project should not require a running studio machine; serve prebuilt preview artifacts + thumbnails from object storage.

---

## Current Architecture (Today)

```
packages/
├── backend/         Express + tRPC backend (still contains some legacy studio routes)
├── frontend/        React frontend (still contains legacy studio UI)
├── studio/          NEW standalone studio (server + client) for isolated editing
├── shared/          Shared types, mode detection, config
├── scraper/         Puppeteer service for thumbnails
└── theme/           Shared CSS variables
```

---

## Target Architecture (SaaS)

```
Control Plane (multi-tenant)
- Auth, orgs, users, limits, billing, domains
- Object storage (Cloudflare R2) as source of truth for project files + artifacts
- Build + thumbnail pipeline (uploads view-only artifacts to R2)
- Publishing + routing (keeps sites up even when studios sleep)
- Optional GitHub sync (backup/audit)

Studio Machine (isolated; per-tenant or per-edit session)
- @vivd/studio (UI + API + OpenCode + preview/devserver)
- Hydrates workspace from R2 on boot (no `git clone`)
- Syncs workspace back to R2 on shutdown (and periodically as safety net)
- Reports usage back to control plane (connected mode)
```

---

## Phase 0: Standalone Studio (MVP)

### 0.1 Studio Separation (DONE)

- [x] Create `packages/studio` with standalone server and client
- [x] Workspace-based workflow: open `VIVD_WORKSPACE_DIR`, commit locally (no remote push required)
- [x] Mode detection via `MAIN_BACKEND_URL` (connected vs standalone)
- [x] `UsageReporter` service for reporting usage to backend
- [x] Usage router that proxies to backend in connected mode
- [x] `studioApiRouter` in backend to receive usage reports
- [x] Workspace open on startup (`VIVD_WORKSPACE_DIR`); optional `REPO_URL` clone for standalone dev

### 0.2 Studio Cleanup & Feature Parity Testing

- [ ] **Test standalone studio for feature parity**
  - [ ] AI agent functionality (OpenCode integration)
  - [ ] File editing and preview
  - [ ] Asset management
  - [ ] Git operations (commit, history, discard)
    - [x] Snapshots: restore older commit + working-commit tracking
    - [x] Snapshot naming uses total git commit count (not truncated history length)

- [ ] **Test connected mode end-to-end**
  - [x] Start studio with `MAIN_BACKEND_URL`, `SESSION_TOKEN`, `STUDIO_ID`
  - [x] Backend accepts `Authorization: Bearer <SESSION_TOKEN>` for `studioApi.*` (machine-to-backend)
  - [x] Verify usage status fetch works (`usage.status`)
  - [ ] Verify usage reporting reaches backend (`studioApi.reportUsage`) (fixed request shape; re-test)
  - [ ] Verify backend-unavailable behavior blocks usage (no bypass)

- [ ] **Clean up legacy studio code from packages**
  - [ ] Remove studio-specific routes from `packages/backend/`
  - [ ] Remove studio UI components from `packages/frontend/`
  - [ ] Confirm no production paths still rely on the legacy studio

### 0.3 Object Storage Sync (R2) (In Progress)

- [x] Define `source/` bucket layout: `tenants/<tenantId>/projects/<slug>/v<version>/source/`
- [ ] Define `preview/` bucket layout: `tenants/<tenantId>/projects/<slug>/v<version>/preview/` (served without a running studio machine)
- [x] Studio supports `VIVD_WORKSPACE_DIR` (no `git clone` required)
- [x] Studio entrypoint hydrates from R2 on boot + periodic sync + final sync on shutdown
- [x] Local studio provider (`STUDIO_MACHINE_PROVIDER=local`) hydrates/syncs via object storage when R2/S3 env vars are set
- [x] OpenCode session storage moved to project-scoped `XDG_DATA_HOME` and synced under a dedicated object-storage prefix (separate from `source/`)
- [x] Maintenance action: export local projects into object storage (initial migration)
- [ ] Move project source-of-truth to R2 (backend reads/writes via object storage, not local FS)
- [ ] Serve view-only preview from R2 (machines can sleep)
- [ ] Decide concurrency/locking model (single-writer lock vs optimistic)
- [ ] Decide sync exclusions (caches, build outputs, large artifacts)

### 0.4 Studio Integration in Main App

- [x] Embed studio in iframe from main frontend (or redirect to studio URL)
- [x] Show view-only preview first; start studio on "Edit"
  - [x] Pass context (project slug, version) to studio (via query params)
  - [x] Pass project slug to studio for breadcrumb display
  - [x] "Back" navigation from studio (postMessage + `returnTo`)
  - [x] Fullscreen studio UX (in-app route, no new tab)
  - [x] Prefer showing studio if already running (project route resumes)
  - [x] Connected usage reports include `projectSlug` + `sessionTitle`
  - [x] Session title updates propagate after rename (studioApi.updateSessionTitle)
  - [x] Auth bridging: reuse existing session token for studio API (no second login)
  - [ ] **Decision needed:** studio URL structure (iframe vs redirect vs subdomain)

### 0.5 Build / Preview / Thumbnail Pipeline (Decision Needed)

- [ ] **Clarify build strategy (R2 is source of truth)**
  - Current: Build happens in backend on publish (Astro) and can run in the background on save
  - [ ] Decide where builds run long-term (backend vs studio vs dedicated builder)
  - [ ] Define preview artifact contract (`preview/` in R2, public vs signed)

- [ ] **Thumbnail generation**
  - Current: Scraper service generates thumbnails
  - [ ] Decide scraper placement (centralized recommended)
  - [ ] Ensure scraper works with the new storage workflow (R2 artifacts)

- [ ] **Preview without studio machine**
  - [ ] Serve prebuilt static versions for quick preview
  - [ ] User clicks "Edit" → spin up / route to studio machine

### 0.6 Docker & CI

- [x] Build `@vivd/shared` in studio Dockerfile (prevents missing `@vivd/shared/dist/*` at runtime)
- [x] Local dev: isolate per-studio internal ports (dev server + OpenCode) via env offsets
- [x] Add studio image to GitHub Actions (build + push GHCR)
- [x] Tag strategy: publish both tag forms (`vX.Y.Z` and `X.Y.Z`) + `latest`
- [x] Add branch-safe studio test workflow (`build-studio-test.yml`) without `latest` or deployment hooks
- [ ] Add minimal smoke checks (container boots + `/health` endpoint)

---

## Phase 1: SaaS Foundation (DONE)

- [x] Create `packages/shared` with types and mode detection
- [x] `SAAS_MODE` environment variable support (backend)
- [x] Auth provider abstraction (local vs control plane)
- [x] Limits service with control plane support
- [x] Create `docker-compose.self-hosted.yml` (best-effort; not a priority)

---

## Phase 2: Control Plane Data Model (Organizations + Project Metadata)

- [ ] **New tables**
  - [ ] `organization` - tenant info, limits, machine reference
  - [ ] `organization_member` - user-org membership with roles
  - [ ] `organization_invitation` - pending invites
  - [ ] `domain` - global domain registry
  - [ ] `subscription_tier` - plan definitions
  - [ ] `tenant_machine` - studio machine registry (url, status, last_active, fly ids)
  - [ ] `project_meta` - project list, display name, description, storage pointer, default version

- [ ] **Existing table modifications**
  - [ ] Add `organization_id` to user, usage_record, usage_period

- [ ] **Move metadata to database**
  - Currently: `manifest.json`, `project.json`, `checklist.json` are files
  - [ ] Design database schema for project metadata
  - [ ] Migration script for existing projects

---

## Phase 3: Authentication, Organizations, and Email

- [ ] **User registration flow**
  - [ ] Email/password registration
  - [ ] Email verification

- [ ] **Password reset flow** (requires email)

- [ ] **Organization management**
  - [ ] Create org on signup
  - [ ] Invite users to organization
  - [ ] Role-based permissions

### Email Integration

> **Provider:** AWS SES | **Domain:** @mail.vivd.studio

- [ ] AWS SES setup (domain verification, DKIM/SPF)
- [ ] `EmailService` implementation
- [ ] Email templates (verification, reset, invite, warnings)
- [ ] System emails (warnings, limit reached, machine issues)

---

## Phase 4: Multi-Tenant Control Plane Adaptation

- [ ] **Query scoping** - all DB queries include `organization_id`
- [ ] **Limits enforcement** - per-org limits from DB/control plane
- [ ] **Object storage isolation** - project sources/artifacts namespaced by org/tenant + permissions enforced
- [ ] **Publishing isolation** - domains/sites scoped to org
- [ ] **Audit log** - record security-relevant actions (studio start/stop, storage writes, publish, invites)

---

## Phase 5: Studio Machine Orchestration (Fly.io)

> For SaaS: On-demand studio machines via Fly.io Machines (or similar).

- [x] Backend: basic Fly.io studio machine provider (local-first; no DB persistence)
- [x] Frontend keepalive + backend `touchStudio` heartbeat (prevents premature Fly suspend while editing)
- [x] Explicit backend idle stop for Fly machines (`FLY_STUDIO_IDLE_TIMEOUT_MS`, default 120s)
- [x] Fly machine reuse on reopen (lookup by metadata/name, recover from name-collision `already_exists`)
- [x] Faster machine bootstrap: hydrate source + OpenCode data from object storage in parallel
- [x] Startup resilience: retry initial usage-status call to backend on transient network failures
- [x] Faster preview startup: persistent package-manager cache in OpenCode data + offline-first installs
- [x] Studio server binds explicitly to `0.0.0.0` for Fly machine ingress compatibility
- [x] Reuse `node_modules` via lockfile-hash cache archive (restore on boot, save after first install)
- [x] Fly machine sizing tunables (`FLY_STUDIO_CPU_KIND`, `FLY_STUDIO_CPUS`, `FLY_STUDIO_MEMORY_MB`)
- [x] Keep studio responsive during dependency install (async install + pause S3 sync loop briefly)
- [ ] Provision studio machine on demand (or per org)
- [ ] Auto-suspend/resume (cost control)
- [ ] Preview → Edit transition (route user to the right machine)
- [ ] Machine auth: control plane issues scoped, short-lived tokens
- [ ] R2 hydration + sync: ensure machines can start/stop without data loss
- [ ] Dev environment testing: spin up multiple studio containers to mimic machines

---

## Phase 6: Super-Admin + Billing + Hardening

### Super-Admin Panel

- [ ] Super-admin authentication (special role)
- [ ] List/view all organizations
- [ ] Modify org limits
- [ ] Suspend/activate orgs
- [ ] System-wide usage dashboard

---

### Billing (Stripe)

- [ ] Stripe products and prices
- [ ] Subscription tiers (Free, Starter, Pro, Enterprise)
- [ ] Billing UI
- [ ] Webhook handling

---

### Monitoring & Hardening

- [ ] Logging/monitoring setup (control plane + studio machines)
- [ ] Rate limiting + abuse prevention (auth, storage sync, preview, agent)
- [ ] Security review (tenant isolation, token scopes, SSRF/file access)
- [ ] Disaster recovery runbook (backups + restores)

---

## Phase 7: Migration, Transfer, Rollout

- [ ] Migration scripts for existing single-tenant installs
- [ ] Project transfer (export/import) for moving between orgs/tenants
- [ ] Rollback plan + staged rollout

---

## Open Decisions

| Question | Options | Status |
|----------|---------|--------|
| Bucket layout for projects | `tenants/<tenantId>/projects/<slug>[/vN]/{source,preview}/` | In progress |
| Studio URL pattern | Iframe `/studio/...` vs redirect vs `{org}.vivd.studio` | TBD |
| Build + preview artifacts | Build-in-backend vs build-in-studio vs dedicated builder | TBD |
| Thumbnails pipeline | Central scraper vs per-tenant scraper | TBD |
| Artifact storage | Object storage (R2) | Decided |
| Published sites serving | From object storage (R2) | Decided |
| Concurrency model | Single-writer lock vs optimistic | TBD |

---

## Environment Variables Reference

### Studio (Connected Mode)
```env
MAIN_BACKEND_URL=https://api.vivd.io   # Enables connected mode
SESSION_TOKEN=<user-auth-token>         # For backend auth
STUDIO_ID=studio-instance-1             # Unique instance ID
VIVD_TENANT_ID=default                  # Optional (defaults to "default")
VIVD_PROJECT_SLUG=project-123           # Which project to edit
VIVD_PROJECT_VERSION=1                  # Which version to edit
VIVD_WORKSPACE_DIR=/home/studio/project # Local workspace directory
# Object storage hydration (Cloudflare R2 via S3 API)
R2_BUCKET=my-platform-bucket
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_ACCESS_KEY=xxx
R2_SECRET_KEY=yyy
DEV_SERVER_PORT_START=5100              # Optional: dev server port range start
OPENCODE_PORT_START=4096                # Optional: OpenCode port range start
OPENCODE_KILL_ORPHANS=0                 # Optional: disable orphan cleanup (needed for local multi-studio)
```

### Backend
```env
SAAS_MODE=true                          # Enable SaaS features
# Studio Machines (Fly.io)
# STUDIO_MACHINE_PROVIDER=fly
# FLY_API_TOKEN=fly_xxx
# FLY_STUDIO_APP=vivd-studio-dev
# FLY_STUDIO_IMAGE=ghcr.io/vivd-studio/vivd-studio:latest
# FLY_STUDIO_REGION=iad
# FLY_STUDIO_PORT_START=3100
# FLY_STUDIO_PUBLIC_HOST=vivd-studio-dev.fly.dev
# FLY_STUDIO_PUBLIC_PROTOCOL=https
# FLY_STUDIO_CPU_KIND=shared
# FLY_STUDIO_CPUS=1
# FLY_STUDIO_MEMORY_MB=1024 (performance mode auto-clamped to Fly minimums)
# FLY_STUDIO_IDLE_TIMEOUT_MS=120000
# FLY_STUDIO_IDLE_CHECK_INTERVAL_MS=30000
# DEVSERVER_INSTALL_TIMEOUT_MS=900000
# VIVD_PACKAGE_CACHE_DIR=/home/studio/opencode-data/package-cache
# DEVSERVER_NODE_MODULES_CACHE=1
# STUDIO_HOST=0.0.0.0
# FLY_STUDIO_ENV_PASSTHROUGH=GOOGLE_API_KEY,OPENROUTER_API_KEY,OPENCODE_MODEL,OPENCODE_MODELS
# ... existing env vars
```

---

## Related Documents

- `docs/multi-tenant-refactor/` - detailed SaaS planning docs
- `docs/multi-tenant-saas-architecture-plan.md` - control plane vs tenant machine split rationale
- `docs/studio-package-refactor-plan.md` - standalone studio design notes

---

*Last updated: 2026-02-07*
