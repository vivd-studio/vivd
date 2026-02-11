# Vivd Project State & Implementation Roadmap

> **Goal:** Run Vivd as a multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and reliable publish/preview flows.

This document is intentionally concise. It tracks what is still open and only keeps high-signal completed milestones.

Related checklist:
- `docs/refactoring-day-checklist.md` - maintainability/refactoring backlog.

Progress log:
- 2026-02-11: added Fly studio start retry when a machine is in `replacing` state to avoid transient "machine getting replaced" boot failures in the frontend.
- 2026-02-11: serialized Studio workspace Git operations and auto-cleaned stale `.git/index.lock` to prevent save failures under concurrent requests/restarts.
- 2026-02-11: optimized release publish workflow to build/push only changed container images between tags and skip deploy when no image-relevant files changed.
- 2026-02-11: enabled multi-org membership per user (auto-detect existing users by email + org switcher via session active org).
- 2026-02-10: added transaction safety to superadmin member/user mutations and removed unused legacy role mutation route.
- 2026-02-10: split `OrganizationsTab` and `AppSidebar` into smaller units; reduced sidebar project polling from 5s to 30s with focus refetch.
- 2026-02-10: roadmap cleaned up to prioritize open work and key milestones.

---

## Guiding Principles

- Object storage (R2/S3 API) is the source of truth for project source + artifacts.
- Studio editing runs on isolated machines (Fly Machines for SaaS).
- Control plane owns auth, orgs, limits, metadata, orchestration, and publishing.
- View-only preview should work without a running studio machine.

---

## Current Priorities

- [ ] Finalize machine lifecycle reliability (start, stop, sync, stale cleanup).
- [ ] Finish remaining auth/org UX edge cases and email-based flows.
- [ ] Add missing system hardening (audit log, monitoring, rate limits).
- [ ] Implement superadmin Fly machine visibility and controls.

---

## Architecture Snapshot

### Current packages

```
packages/
├── backend/         Control plane backend (Express + tRPC)
├── frontend/        Main React app (preview/dashboard + studio embed)
├── studio/          Standalone studio (UI + API + OpenCode)
├── shared/          Shared types/config
├── scraper/         Thumbnail service (Puppeteer)
└── theme/           Shared CSS variables/themes
```

### SaaS target split

- **Control plane (multi-tenant):** auth/orgs/limits, metadata, storage, publish/routing, orchestration.
- **Studio machine (isolated):** workspace hydration, editing, preview/devserver, periodic + shutdown sync.

---

## Phase 0: Standalone Studio + Bucket-First Runtime

### Completed highlights

- [x] Studio extracted into `packages/studio` with connected/standalone mode.
- [x] Legacy editor code removed from backend/frontend packages.
- [x] R2 hydration + periodic + shutdown sync wired into studio startup lifecycle.
- [x] Bucket-backed preview serving works without live studio machine.
- [x] Publish path is bucket-first; checklist authority moved to DB.
- [x] Unified publish UX across Studio and app shell.
- [x] Scraper flow adapted for bucket-backed preview artifacts.

### Open work

- [ ] Standalone parity verification (AI agent, editing/preview, assets, Git operations).
- [ ] Connected mode verification:
  - [ ] Re-test usage reporting (`studioApi.reportUsage`).
  - [ ] Confirm backend-unavailable behavior correctly blocks usage.
- [ ] Move backend project source-of-truth fully to object storage (remove remaining local-FS dependency).
- [ ] Decide concurrency/locking model (single-writer lock vs optimistic).
  - [x] Studio Git operations serialized (avoid `.git/index.lock` contention).
- [ ] Finalize sync exclusions (`dist/`, `.astro/`, caches, large artifacts).
- [ ] Decide studio URL shape (iframe route vs redirect vs subdomain).
- [ ] Build strategy decisions:
  - [ ] Long-term build location (backend vs studio vs dedicated builder).
  - [ ] Preview artifact contract (`preview/`, public vs signed).
- [ ] Preview -> Edit transition: reliably route user to target studio machine.
- [ ] Add minimal studio container smoke checks (`/health`).

---

## Phase 1: SaaS Foundation

### Completed highlights

- [x] Shared package created for cross-service types/config.
- [x] Dual-mode `SAAS_MODE` complexity removed.
- [x] Self-hosted compose kept as best-effort path.

### Open work

- No critical open items.

---

## Phase 2: Control Plane Data Model

### Completed highlights

- [x] Core org/project/checklist tables implemented and integrated.
- [x] Tenant scoping columns added to tenant-bound data.
- [x] Project metadata/checklist source-of-truth moved from files to DB.

### Open work

- [ ] Add `domain` table (global uniqueness registry).
- [ ] Add `subscription_tier` table.
- [ ] Add `tenant_machine` table (machine URL/status/activity/Fly IDs).

---

## Phase 3: Authentication, Organizations, Email

### Completed highlights

- [x] Open signup disabled (bootstrap + invite-oriented model).
- [x] Superadmin provisioning flow implemented.
- [x] Tenant admin/member management and admin-assisted password reset implemented.
- [x] Role/permission model consolidated around org membership.
- [x] Users can join multiple orgs and switch active org (main host / session-based selection).

### Open work

- [ ] Host/org mismatch UX (guide user to correct tenant domain).
- [ ] Invite-only signup via email links (SES-dependent).
- [ ] Self-service password reset via email link.
- [ ] Email integration:
  - [ ] SES domain setup (DKIM/SPF).
  - [ ] `EmailService` implementation.
  - [ ] Email templates (verification, reset, invite, warnings).
  - [ ] System emails (warnings, limits, machine issues).

---

## Phase 4: Multi-Tenant Control Plane Adaptation

### Completed highlights

- [x] Tenant query scoping enforced.
- [x] Per-org usage/project limits enforced.
- [x] Object-storage and publishing isolation enforced per org.

### Open work

- [ ] Add audit log for security-relevant actions (machine start/stop, storage writes, publish, invites).

---

## Phase 5: Studio Machine Orchestration (Fly.io)

### Completed highlights

- [x] Fly provider baseline implemented with machine reuse and idle suspend/resume.
- [x] Startup resilience and performance improvements shipped (parallel hydration, cache reuse, async install flow).
- [x] Config/image reconciliation and image auto-selection from GHCR implemented.

### Open work

- [ ] Provision studio machine on demand (or per-org strategy).
- [ ] Decide Fly app strategy (single app vs app-per-tenant).
- [ ] Machine auth: scoped short-lived control-plane-issued tokens.
- [ ] Validate hydration/sync behavior for start/stop cycles under failure scenarios.
- [ ] Dev-environment multi-machine test coverage.
- [ ] Stale machine lifecycle cleanup (cost + safety):
  - [ ] Periodically identify machines older than 7 days.
  - [ ] Stop first to allow shutdown sync back to bucket.
  - [ ] Destroy after successful stop/sync (with timeout/fallback handling).

---

## Phase 6: Super-Admin, Billing, Hardening

### Super-admin

- [x] Super-admin auth and host-gated route strategy implemented.
- [x] Organization lifecycle + limits management implemented.
- [ ] Add Fly machines overview (org mapping, status, age, last activity, lifecycle actions).

### Billing

- [ ] Stripe products/prices.
- [ ] Subscription tiers and billing UI.
- [ ] Stripe webhook handling.

### Hardening

- [ ] Logging/monitoring for control plane + studio machines.
- [ ] Rate limiting + abuse prevention.
- [ ] Security review (tenant isolation, token scopes, SSRF/file access).
- [ ] Disaster recovery runbook.

---

## Phase 7: Migration, Transfer, Rollout

- [ ] Migration scripts for existing single-tenant installs.
- [ ] Project transfer flow (org-to-org export/import).
- [ ] Rollback plan + staged rollout.

---

## Open Decisions

| Question | Options | Status |
|----------|---------|--------|
| Studio URL pattern | Iframe `/studio/...` vs redirect vs `{org}.vivd.studio` | TBD |
| Fly app strategy | Single shared app vs app-per-tenant | TBD |
| Concurrency model | Single-writer lock vs optimistic | TBD |
| Build execution location | Backend vs studio vs dedicated builder | TBD |
| Preview artifact exposure | Public vs signed URLs | TBD |
| Thumbnails pipeline scaling | Central scraper vs per-tenant scraper | TBD |

---

## Related Documents

- `docs/multi-tenant-refactor/` - detailed SaaS planning docs.
- `docs/multi-tenant-saas-architecture-plan.md` - control-plane vs machine split rationale.
- `docs/studio-package-refactor-plan.md` - standalone studio design notes.
- `docs/publishing-bucket-first-plan.md` - bucket-first publish/preview decisions.
- `docs/multi-tenant-refactor/organization-auth-plan.md` - org auth + superadmin plan.

---

*Last updated: 2026-02-11*
