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
├── backend/         Express + tRPC backend (control plane: auth, metadata, publishing, studio orchestration)
├── frontend/        React frontend (project list + view-only preview + embeds studio)
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
    - [x] Ignore stale working-commit marker after HEAD-only auto snapshots (prevents persistent false "unsaved changes")
    - [x] Restore optional GitHub org sync on Studio save (env-driven; best-effort unless `GITHUB_SYNC_STRICT=true`)

- [ ] **Test connected mode end-to-end**
  - [x] Start studio with `MAIN_BACKEND_URL`, `SESSION_TOKEN`, `STUDIO_ID`
  - [x] Backend accepts `Authorization: Bearer <SESSION_TOKEN>` for `studioApi.*` (machine-to-backend)
  - [x] Verify usage status fetch works (`usage.status`)
  - [ ] Verify usage reporting reaches backend (`studioApi.reportUsage`) (fixed request shape; re-test)
  - [ ] Verify backend-unavailable behavior blocks usage (no bypass)

- [ ] **Clean up legacy studio code from packages**
  - [x] Remove legacy editor routes from `packages/backend/`
  - [x] Remove legacy editor UI from `packages/frontend/`
  - [x] Confirm main app only embeds `@vivd/studio` for editing

### 0.3 Object Storage Sync (R2) (In Progress)

- [x] Define `source/` bucket layout: `tenants/<tenantId>/projects/<slug>/v<version>/source/`
- [x] Define `preview/` bucket layout: `tenants/<tenantId>/projects/<slug>/v<version>/preview/` (latest build only; overwritten)
- [x] Define `published/` bucket layout: `tenants/<tenantId>/projects/<slug>/v<version>/published/` (latest build only; overwritten)
- [x] Studio supports `VIVD_WORKSPACE_DIR` (no `git clone` required)
- [x] Studio entrypoint hydrates from R2 on boot + periodic sync + final sync on shutdown
- [x] Local studio provider (`STUDIO_MACHINE_PROVIDER=local`) hydrates/syncs via object storage when R2/S3 env vars are set
- [x] OpenCode session storage moved to project-scoped `XDG_DATA_HOME` and synced under a dedicated object-storage prefix (separate from `source/`)
- [x] Maintenance action: export local projects into object storage (initial migration)
- [ ] Move project source-of-truth to R2 (backend reads/writes via object storage, not local FS)
- [x] Serve view-only preview from R2 (machines can sleep)
- [x] Harden preview streaming from R2 against client disconnects (avoid noisy `ERR_STREAM_UNABLE_TO_PIPE`)
- [ ] Decide concurrency/locking model (single-writer lock vs optimistic)
- [ ] Decide sync exclusions (caches, build outputs, large artifacts) (initial: exclude `dist/` + `.astro/`)

### 0.4 Studio Integration in Main App

- [x] Embed studio in iframe from main frontend (or redirect to studio URL)
- [x] Show view-only preview first; start studio on "Edit"
  - [x] Pass context (project slug, version) to studio (via query params)
  - [x] Pass project slug to studio for breadcrumb display
  - [x] "Back" navigation from studio (postMessage + `returnTo`)
  - [x] Fullscreen studio UX (in-app route, no new tab)
  - [x] Animated studio startup loading screen with first-startup timing hint
  - [x] Theme synchronization between app shell and embedded/fullscreen studio (light/dark + color theme)
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
  - [x] Add per-project toggle for public preview URLs (`project_meta.publicPreviewEnabled`)

### 0.5.1 Publishing / Checklist Consolidation (Decided 2026-02-08)

- [ ] **Bucket-first publish + preview (no local project dir dependency in runtime paths)**
  - [x] Publish pipeline must not read from local `projects/<slug>/vN` as source
  - [x] Preview serving must not depend on local `versionDir` detection/fallback in connected/prod mode
  - [x] Generation flows may continue using temporary local workspace, then sync artifacts to bucket on completion
  - [x] Restore backend scratch multipart upload route and post-generation artifact sync for 3-step scratch flow
  - [x] Make Scratch Wizard mobile-responsive (form-first layout + mobile preview sheet)
- [ ] **Reuse preview artifacts for publish**
  - [x] Astro publish uses ready `preview/` artifact (no rebuild on publish)
  - [x] Static publish uses `source/` artifact
  - [x] Add readiness/race checks (`artifact_not_ready`, optional expected-hash compare-and-swap)
- [x] **Unified publish UX across Studio + app shell**
  - [x] Keep publish/unpublish available in Studio and preview/dashboard
  - [x] Route all publish/unpublish through backend publish APIs (single behavior)
  - [x] Use non-technical labels ("Publish site", "Unpublish site")
  - [x] In connected mode, Studio publish dialog shows backend publish status (URL/domain, version, publishedAt)
  - [x] In connected mode, Studio publish dialog exposes unpublish action using backend API
  - [x] Show explicit unsaved-changes warning when Studio has newer unsynced edits
  - [x] Add CTA button in publish dialog: "Open Studio to save changes"
  - [x] Show deterministic publish dialog states: Ready / Build in progress / Unsaved changes in Studio
  - [x] Show exact artifact being published (source kind, built time, short hash) before confirmation
  - [x] Live Studio workspace-state reporting (dirty/head) blocks publish while Studio has unsaved changes
- [ ] **Checklist DB-only**
  - [x] Studio checklist run/fix must upsert into `project_publish_checklist`
  - [x] Remove `.vivd/publish-checklist.json` as authoritative source
  - [x] Expose checklist state/freshness for publish dialogs outside Studio
- [x] **Studio provider parity**
  - [x] Keep local studio provider behavior aligned with production flow (hydrate/sync via bucket, publish consumes bucket artifacts)

- [ ] **Thumbnail generation**
  - Current: Scraper service generates thumbnails
  - [x] Fix screenshot clipping on sites where `document.body.scrollHeight` is `0`
  - [x] Decide scraper placement: centralized in backend (studio requests regen after snapshot sync)
  - [x] Ensure scraper works with the new storage workflow (bucket-backed previews; no local FS dependency)
  - [x] Prevent generation-time race: only generate initial thumbnails after artifact sync, require `index.html` for preview readiness, and retry transient preview-not-ready responses
  - [x] Make maintenance action "Generate missing thumbnails" bucket/DB-aware (no local directory scan dependency; checks `thumbnailKey` + object existence when storage is configured)
  - [x] Disable bulk "regenerate all thumbnails" maintenance action to control compute costs
  - [x] Add per-project thumbnail regeneration action in project card and preview header actions

- [ ] **Preview without studio machine**
  - [x] Serve bucket-backed prebuilt previews for quick preview
  - [x] Support disabling public preview URLs per project (fallback to authenticated access)
  - [x] Public preview URLs copied on the shared host include `__vivd_org` for unauthenticated tenant resolution (temporary; consider per-tenant subdomains later)
  - [ ] User clicks "Edit" → spin up / route to studio machine

### 0.6 Docker & CI

- [x] Build `@vivd/shared` in studio Dockerfile (prevents missing `@vivd/shared/dist/*` at runtime)
- [x] Local dev: isolate per-studio internal ports (dev server + OpenCode) via env offsets
- [x] Add studio image to GitHub Actions (build + push GHCR)
- [x] Publish workflow builds/pushes `vivd-studio` first (faster studio iteration)
- [x] Tag strategy: publish both tag forms (`vX.Y.Z` and `X.Y.Z`) + `latest`
- [x] Add branch-safe studio test workflow (`build-studio-test.yml`) without `latest` or deployment hooks
- [ ] Add minimal smoke checks (container boots + `/health` endpoint)

---

## Phase 1: SaaS Foundation (DONE)

- [x] Create `packages/shared` with types and mode detection
- [x] Remove `SAAS_MODE` / control-plane dual-mode complexity (always local Better Auth + env-based limits)
- [x] Create `docker-compose.self-hosted.yml` (best-effort; not a priority)

---

## Phase 2: Control Plane Data Model (Organizations + Project Metadata)

- [x] **New tables**
  - [x] `organization` - tenant info, status, limits, machine reference
  - [x] `organization_member` - user↔org membership with roles (owner/admin/member/client_editor)
  - [x] `organization_invitation` - pending invites (invite-only onboarding)
  - [ ] `domain` - global domain registry (unique across server)
  - [ ] `subscription_tier` - plan definitions
  - [ ] `tenant_machine` - studio machine registry (url, status, last_active, fly ids)
  - [x] `project_meta` - project list + metadata (slug, title/desc, current version)
  - [x] `project_version` - per-version status/meta + thumbnail key
  - [x] `project_publish_checklist` - DB-backed publish checklist

- [x] **Existing table modifications**
  - [x] Add `active_organization_id` to Better Auth `session` (single-org UX default; supports future multi-org)
  - [x] Add `organization_id` to all tenant-scoped tables:
    - [x] `project_meta`, `project_version`, `project_publish_checklist`
    - [x] `project_member`
    - [x] `published_site` (domain stays globally unique)
    - [x] `usage_record`, `usage_period`

- [x] **Move metadata to database**
  - Previously: `manifest.json`, `.vivd/project.json`, `.vivd/publish-checklist.json` were file-backed
  - [x] Design database schema for project metadata
  - [x] Migration script for existing projects (`npm run migrate:project-meta -w @vivd/backend`)
  - [x] Maintenance tab action for migration (Admin → Maintenance → "Migrate Project Metadata to DB")
  - [x] Runtime uses DB as source of truth (no legacy file reads/writes)
  - [x] Touch `project_meta.updatedAt` on editor actions (snapshots/edits) so UI sorting reflects real activity
  - [x] Project/version deletion removes DB records + bucket artifacts (prevents ghost projects and storage leaks)

---

## Phase 3: Authentication, Organizations, and Email

- [ ] **Onboarding model (no public signup)**
  - [x] Disable open self-registration (sign-up allowed only for bootstrap and/or org invitations)
  - [x] Bootstrap super-admin for new installs (first-run only; then lock down)
  - [x] Super-admin provisions organizations + initial org owner/admin (tRPC `superadmin.*`)
  - [x] Org admins add/manage members (set passwords) via org admin panel (`/vivd-studio/admin`)
  - [x] Org admin member table supports inline role/project updates (owner-protected, self-role guarded)
  - [ ] (Later) Invite-only signup + email links (requires SES)

- [ ] **Password reset flow** (requires email)

- [ ] **Organization management**
  - [x] Domain-based tenant resolution: visiting `<tenant-domain>/vivd-studio` lands in that org
  - [ ] Host/org mismatch UX: block access + guide user to correct domain (prevents “logged-in on wrong tenant domain”)
  - [x] Role-based permissions (org roles vs super-admin role; host-gated superadmin)
  - [x] Consolidate role semantics: tenant permissions derive from `organization_member.role`; global role is for super-admin/system scope only
  - [x] Tenant admin dashboard restored as tabbed single page (`users`, `usage`, `maintenance`) with grouped sidebar navigation
  - [x] Recover from stale/missing `active_organization_id` by auto-selecting a preferred membership org (restores tenant admin/member routing)
  - [x] Enforce org suspension (blocked for non-super-admins)

### Email Integration

> **Provider:** AWS SES | **Domain:** @mail.vivd.studio

- [ ] AWS SES setup (domain verification, DKIM/SPF)
- [ ] `EmailService` implementation
- [ ] Email templates (verification, reset, invite, warnings)
- [ ] System emails (warnings, limit reached, machine issues)

---

## Phase 4: Multi-Tenant Control Plane Adaptation

- [x] **Query scoping** - all tenant data queries include `organization_id` (no cross-tenant reads/writes)
  - [x] Non-tRPC endpoints (`/preview`, `/upload`, `/download`, `/import`) enforce org membership/suspension (private access)
- [x] **Limits enforcement** - per-org limits from DB (set via super-admin panel)
  - [x] Credits + image generation limits (agent/generation gating)
  - [x] `maxProjects` enforced (blocks new projects/imports)
- [x] **Object storage isolation** - project sources/artifacts namespaced by org/tenant + enforced in backend + studio machine env
- [x] **Publishing isolation** - domains/sites scoped to org; domain uniqueness remains server-wide
- [ ] **Audit log** - record security-relevant actions (studio start/stop, storage writes, publish, invites)

---

## Phase 5: Studio Machine Orchestration (Fly.io)

> For SaaS: On-demand studio machines via Fly.io Machines (or similar).

- [x] Backend: basic Fly.io studio machine provider (local-first; no DB persistence)
- [x] Frontend keepalive + backend `touchStudio` heartbeat (prevents premature Fly suspend while editing)
- [x] Explicit backend idle suspend for Fly machines (`FLY_STUDIO_IDLE_TIMEOUT_MS`, default 120s; stop fallback if suspend unsupported)
- [x] Fly machine reuse on reopen (lookup by metadata/name, recover from name-collision `already_exists`)
- [x] Faster machine bootstrap: hydrate source + OpenCode data from object storage in parallel
- [x] Startup resilience: retry initial usage-status call to backend on transient network failures
- [x] Faster preview startup: persistent package-manager cache in OpenCode data + offline-first installs
- [x] Studio server binds explicitly to `0.0.0.0` for Fly machine ingress compatibility
- [x] Reuse `node_modules` via lockfile-hash cache archive (restore on boot, save after first install)
- [x] Auto-recover stale project `node_modules` (esbuild host/binary mismatch) by forcing dependency reinstall before dev server launch
- [x] Fly machine sizing tunables (`FLY_STUDIO_CPU_KIND`, `FLY_STUDIO_CPUS`, `FLY_STUDIO_MEMORY_MB`)
- [x] Keep studio responsive during dependency install (async install + pause S3 sync loop briefly)
- [x] Avoid unexpected wakeups: backend controls starts (Fly `autostart=false`; status checks do not count as keepalive)
- [x] Lazy machine config/image reconciliation on next start (update `config.image` + service autostart/autostop via Machines API)
- [x] Auto studio image selection from GHCR semver tags by default (optional `FLY_STUDIO_IMAGE_REPO` source override and `FLY_STUDIO_IMAGE` pin override)
- [ ] Provision studio machine on demand (or per org)
- [ ] **Decision needed:** Fly app strategy per tenant/org (single app vs app-per-tenant)
  - Fly apps have a machine quota limit (often ~50 machines/app by default); might require a support request to increase.
  - App-per-tenant can improve isolation and quota control, but adds operational overhead (deployments, secrets, routing, monitoring).
  - Likely start with a single shared app + quota increase; consider dedicated apps for very large/enterprise tenants later.
- [x] Auto-suspend/resume (cost control)
- [ ] Preview → Edit transition (route user to the right machine)
- [ ] Machine auth: control plane issues scoped, short-lived tokens
- [ ] R2 hydration + sync: ensure machines can start/stop without data loss
- [ ] Dev environment testing: spin up multiple studio containers to mimic machines

---

## Phase 6: Super-Admin + Billing + Hardening

### Super-Admin Panel

- [x] Super-admin authentication (special role; bootstrap existing admin → super-admin)
- [x] Super-admin panel access strategy (host-gated via `SUPERADMIN_HOSTS`; routes under `/vivd-studio/superadmin/*`)
- [x] Create organizations + initial org owner/admin
- [x] List/view all organizations + members
- [x] Modify org limits + suspend/activate orgs
- [x] Set per-org GitHub repo prefix (used by studio machines)
- [x] Super-admin dashboard grouped/tabs for `organizations`, `system users`, and `maintenance`
- [x] Usage dashboard positioned as tenant-admin concern (per active org), not super-admin navigation

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
| Super-admin panel access | Default tenant only vs dedicated admin host | Decided (2026-02-10): default tenant only |
| Tenant resolution source | Host-based (`<domain>/vivd-studio`) vs session active-org vs hybrid | Decided (2026-02-10): hybrid |
| Build + preview artifacts | Build preview on save; publish reuses ready artifacts from bucket | Decided (2026-02-08) |
| Thumbnails pipeline | Central scraper vs per-tenant scraper | TBD |
| Artifact storage | Object storage (R2) | Decided |
| Published sites serving | Caddy serves local `/srv/published`, materialized from bucket artifact | Decided (2026-02-08) |
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
# No SAAS_MODE: backend runs single-mode (Better Auth + env-based limits).
# Studio Machines (Fly.io)
# STUDIO_MACHINE_PROVIDER=fly
# FLY_API_TOKEN=fly_xxx
# FLY_STUDIO_APP=vivd-studio-dev
# Auto image selection is default (latest semver from ghcr.io/vivd-studio/vivd-studio)
# Optional source override:
# FLY_STUDIO_IMAGE_REPO=ghcr.io/vivd-studio/vivd-studio
# Optional pin override:
# FLY_STUDIO_IMAGE=ghcr.io/vivd-studio/vivd-studio:0.2.2
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
# GitHub sync (forwarded to Fly studio machines by default):
# GITHUB_SYNC_ENABLED=true
# GITHUB_ORG=vivd-studio
# GITHUB_TOKEN=ghp_xxx
# GITHUB_REPO_PREFIX=dev-
# STUDIO_HOST=0.0.0.0
# FLY_STUDIO_ENV_PASSTHROUGH=GOOGLE_API_KEY,OPENROUTER_API_KEY,OPENCODE_MODEL,OPENCODE_MODELS
# ... existing env vars
```

---

## Related Documents

- `docs/multi-tenant-refactor/` - detailed SaaS planning docs
- `docs/multi-tenant-saas-architecture-plan.md` - control plane vs tenant machine split rationale
- `docs/studio-package-refactor-plan.md` - standalone studio design notes
- `docs/publishing-bucket-first-plan.md` - agreed plan for bucket-first publish/preview + checklist DB-only
- `docs/multi-tenant-refactor/organization-auth-plan.md` - org auth + super-admin + tenant scoping plan

---

*Last updated: 2026-02-10*
