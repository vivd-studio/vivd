# Vivd Project State & Implementation Roadmap

> **Goal:** Transform Vivd into a multi-tenant SaaS platform with a standalone studio (git-in / git-out).

This document tracks the current state of development and serves as the canonical implementation plan. Check off items as they are completed.

---

## Guiding Principles

- **Git as IO:** Studio machines take a git repo URL as input and only write changes by commit + push.
- **Studio can run standalone:** The studio must be able to run standalone (git-in / git-out); full self-hosted stack parity is best-effort only.
- **Isolation for safety:** The OpenCode agent can run shell commands and access the filesystem, so editing cannot be safely multi-tenant on one shared machine without heavy sandboxing. For SaaS, run studio as isolated machines (e.g. Fly.io Machines).
- **Control plane vs studio:** The control plane owns auth, orgs, limits, project metadata, git hosting, and orchestration. The studio machine owns the working copy, preview/devserver, and editing UX.
- **Fast view-only preview:** Viewing a project should not require a running studio machine; serve a prebuilt artifact + thumbnails from the control plane.

---

## Current Architecture (Today)

```
packages/
├── backend/         Express + tRPC backend (still contains legacy studio + git server)
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
- Git server (repos are the source of truth)
- Build + thumbnail pipeline (produces view-only artifacts)
- Publishing + routing (keeps sites up even when studios sleep)

Studio Machine (isolated; per-tenant or per-edit session)
- @vivd/studio (UI + API + OpenCode + preview/devserver)
- Clones repo on boot, commits + pushes edits back to git server
- Reports usage back to control plane (connected mode)
```

---

## Phase 0: Standalone Studio (MVP)

### 0.1 Studio Separation (DONE)

- [x] Create `packages/studio` with standalone server and client
- [x] Git-based workflow: clone on startup, commit + push edits back to remote
- [x] Mode detection via `MAIN_BACKEND_URL` (connected vs standalone)
- [x] `UsageReporter` service for reporting usage to backend
- [x] Usage router that proxies to backend in connected mode
- [x] `studioApiRouter` in backend to receive usage reports
- [x] Git clone on startup with retry logic

### 0.2 Studio Cleanup & Feature Parity Testing

- [ ] **Test standalone studio for feature parity**
  - [ ] AI agent functionality (OpenCode integration)
  - [ ] File editing and preview
  - [ ] Asset management
  - [ ] Git operations (commit, history, discard)

- [ ] **Test connected mode end-to-end**
  - [ ] Start studio with `MAIN_BACKEND_URL`, `SESSION_TOKEN`, `STUDIO_ID`
  - [ ] Verify usage status fetch works (`usage.status`)
  - [ ] Verify usage reporting reaches backend (`studioApi.reportUsage`)
  - [ ] Verify backend-unavailable behavior blocks usage (no bypass)

- [ ] **Clean up legacy studio code from packages**
  - [ ] Remove studio-specific routes from `packages/backend/`
  - [ ] Remove studio UI components from `packages/frontend/`
  - [ ] Confirm no production paths still rely on the legacy studio

### 0.3 Git Server Hardening (Partially Done)

- [x] Git HTTP protocol endpoints (`gitHttp.ts`, `GitHttpService.ts`)
- [x] Clone/fetch/pull via `git-upload-pack`
- [x] Push via `git-receive-pack` with build trigger
- [x] Basic auth via `gitAuthMiddleware`
- [ ] Test git server with multiple concurrent users
- [ ] Define authorization model (repo access scoped to org/project)
- [ ] Multi-tenant git structure (currently uses `{slug}/v{version}` in projects dir)
  - [ ] Decide namespacing (e.g. `{orgId}/{slug}/v{version}`)
  - [ ] Migration plan for existing repos
- [ ] Decide how studios authenticate to git (scoped tokens vs long-lived PAT)

### 0.4 Studio Integration in Main App

- [ ] Embed studio in iframe from main frontend (or redirect to studio URL)
- [ ] Pass context (project slug, version, org info) to studio
- [ ] Pass project slug/name to studio for breadcrumb display
- [ ] "Back to Dashboard" navigation from studio
- [ ] Auth bridging: reuse existing session token for studio API (no second login)
- [ ] **Decision needed:** studio URL structure (iframe vs redirect vs subdomain)

### 0.5 Build / Preview / Thumbnail Pipeline (Decision Needed)

- [ ] **Clarify build strategy (git is source of truth)**
  - Current: Build happens in backend on git push (Astro projects)
  - [ ] Decide where builds run long-term (backend on push vs studio vs dedicated builder)
  - [ ] Decide where artifacts live (local filesystem for dev vs object storage for SaaS)

- [ ] **Thumbnail generation**
  - Current: Scraper service generates thumbnails
  - [ ] Decide scraper placement (centralized recommended)
  - [ ] Ensure scraper works with the new git/build artifact workflow

- [ ] **Preview without studio machine**
  - [ ] Serve prebuilt static versions for quick preview
  - [ ] User clicks "Edit" → spin up / route to studio machine

### 0.6 Docker & CI

- [x] Build `@vivd/shared` in studio Dockerfile (prevents missing `@vivd/shared/dist/*` at runtime)
- [ ] Add studio image to GitHub Actions (build + push GHCR)
- [ ] Decide tags/strategy (branch tags vs semver)
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
  - [ ] `project_meta` - project list, display name, description, repo pointer, default version

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
- [ ] **Git server isolation** - repos namespaced by tenant + permissions enforced
- [ ] **Publishing isolation** - domains/sites scoped to org
- [ ] **Audit log** - record security-relevant actions (git pushes, publish, invites)

---

## Phase 5: Studio Machine Orchestration (Fly.io)

> For SaaS: On-demand studio machines via Fly.io Machines (or similar).

- [ ] Provision studio machine on demand (or per org)
- [ ] Auto-suspend/resume (cost control)
- [ ] Preview → Edit transition (route user to the right machine)
- [ ] Machine auth: control plane issues scoped, short-lived tokens
- [ ] Backup/restore strategy (e.g. sync git mirror + build artifacts to object storage)
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
- [ ] Rate limiting + abuse prevention (auth, git, preview, agent)
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
| Git repo structure for tenants | `{orgId}/{slug}/v{version}` vs separate git roots | TBD |
| Studio URL pattern | Iframe `/studio/...` vs redirect vs `{org}.vivd.studio` | TBD |
| Build + preview artifacts | Build-on-push vs build-in-studio vs dedicated builder | TBD |
| Thumbnails pipeline | Central scraper vs per-tenant scraper | TBD |
| Artifact storage | Local filesystem (dev) vs object storage (e.g. R2) | TBD |
| Published sites serving | From object storage via control plane vs from tenant machines | TBD |

---

## Environment Variables Reference

### Studio (Connected Mode)
```env
MAIN_BACKEND_URL=https://api.vivd.io   # Enables connected mode
SESSION_TOKEN=<user-auth-token>         # For backend auth
STUDIO_ID=studio-instance-1             # Unique instance ID
REPO_URL=http://backend/git/...         # Git repo to clone
GIT_TOKEN=<optional-git-auth>           # If git server requires auth
```

### Backend
```env
SAAS_MODE=true                          # Enable SaaS features
# ... existing env vars
```

---

## Related Documents

- `docs/multi-tenant-refactor/` - detailed SaaS planning docs
- `docs/multi-tenant-saas-architecture-plan.md` - control plane vs tenant machine split rationale
- `docs/studio-package-refactor-plan.md` - standalone studio design notes

---

*Last updated: 2026-02-01*
