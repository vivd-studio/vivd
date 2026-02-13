# Vivd Project State & Implementation Roadmap

> **Goal:** Run Vivd as a multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and reliable publish/preview flows.

This document is intentionally concise. It tracks what is still open and only keeps high-signal completed milestones.

Related checklist:
- `docs/refactoring-day-checklist.md` - maintainability/refactoring backlog.

Progress log:
- 2026-02-13: fixed production “Copy preview URL” from the embedded Studio to use canonical tenant-host preview URLs (works without authentication) and removed the temporary `__vivd_org` preview fallback.
- 2026-02-12: fixed prod lockout when visiting the tenant base domain (e.g. `vivd.studio`) by treating it as a control-plane alias when it is not explicitly registered as an active tenant/publish domain; also made backend context resolution auto-select a preferred org even on `hostKind=unknown`, preventing `project.list` 401 loops, and improved frontend project-list polling + error visibility.
- 2026-02-12: added backend bearer-token org fallback for studio machine calls on non-control-plane hosts: when no org can be resolved by host/header, context now falls back to session active org (or preferred membership org), reducing `No organization selected` 401s during staggered studio image rollouts.
- 2026-02-12: fixed connected studio machine 401s after tenant-domain routing rollout by propagating explicit org context (`x-vivd-organization-id` from `VIVD_TENANT_ID`) on studio->backend tRPC calls and honoring it in backend context resolution for authenticated members when host is not org-pinned.
- 2026-02-12: fixed super-admin host/control-plane env propagation in compose deployments by forwarding `CONTROL_PLANE_HOST`/`SUPERADMIN_HOSTS` (plus tenant routing envs) to backend services, and corrected backend local `.env` bootstrap path to repo root (`packages/backend/src/init-env.ts`).
- 2026-02-12: fixed stale ZIP exports in bucket-first mode by making backend `download/:slug/:version` object-storage-only (source artifact with Astro preview fallback, no local-FS fallback), reintroduced "Download as ZIP" in studio toolbar options (desktop/mobile), and triggered source-artifact sync after in-studio patch saves so exports reflect latest edits sooner.
- 2026-02-12: documented production Dokploy/Traefik wildcard setup runbook for `*.vivd.studio`, including Hetzner DNS-challenge resolver wiring, validation commands, and known failure modes (`docs/dokploy-traefik-wildcard-setup.md`).
- 2026-02-12: hardened cross-host org switching: prefer tenant hosts matching the current base domain (e.g. `*.localhost`), redirect to control-plane for orgs without a tenant host (auto-switch via `__vivd_switch_org`), and removed “host redirect” UI copy.
- 2026-02-12: fixed backend org-switch tenant-host response to return only registered active tenant hosts (removed computed fallback like `default.localhost`).
- 2026-02-12: fixed control-plane org switcher regression for organizations without a tenant host (e.g. `default`), while keeping tenant-host redirect requirements on host-pinned domains.
- 2026-02-12: implemented tenant-domain governance core: added `domain` registry + migration/backfill, host-based context resolution (`hostKind`/host-pinned org), super-admin domain management APIs/UI, publish allowlist enforcement, host-aware org switch redirects, and tenant-host canonical preview URLs (with temporary logged `__vivd_org` fallback).
- 2026-02-12: extended tenant subdomain/domain governance plan with explicit local-development parity (`app.localhost` + `{org}.localhost`, with nip.io as fallback), cross-subdomain session checks, and local smoke checklist.
- 2026-02-12: locked tenant-domain auth boundary decision: `super_admin` stays a global user role; `default` remains a normal org and does not grant platform-wide permissions.
- 2026-02-12: added dedicated implementation plan for tenant subdomain routing + domain governance (`docs/tenant-subdomain-domain-governance-plan.md`).
- 2026-02-12: production Traefik wildcard routing for `*.vivd.studio` validated (DNS + wildcard TLS) and tenant-domain rollout planning started (org hostnames, domain allowlist, publish restrictions).
- 2026-02-11: added older-snapshot warnings + one-click "Restore Snapshot" flow; blocked publishing while Studio is pinned to an older snapshot to prevent publishing unexpected content.
- 2026-02-11: simplified publish dialog: publishing is blocked when Studio has unsaved changes or is viewing an older snapshot; users must save/restore/back-to-latest before publishing (no combined "Save & Publish" / "Restore & Publish").
- 2026-02-11: fixed ZIP import for bucket-first runtime by accepting metadata-less exported ZIP roots, syncing imported source/preview artifacts to object storage, and hardening tenant selection to prevent default-tenant leakage.
- 2026-02-11: added in-studio "Hard restart" to force a fresh studio boot (rehydrate source from object storage) when a suspended machine resumes with an empty/stale workspace.
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
- [ ] Complete tenant-domain rollout hardening (verification automation, fallback removal window, and production observability tuning).
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

- [x] Add `domain` table (global uniqueness registry) with:
  - [x] Domain owner org, status (`pending_verification`/`active`/`disabled`), and type (`managed_subdomain`/`custom_domain`).
  - [x] Domain usage flags (`tenant_host`, `publish_target`) and audit metadata.
  - [x] Verification data for custom domains (TXT/HTTP token + verified timestamp).
- [x] Backfill managed tenant host domains (`{orgSlug}.vivd.studio`) for existing orgs and enforce global uniqueness.
- [x] Add reserved slug/domain labels (e.g. `app`, `www`, `api`, `admin`) and validate them on org creation and any slug-change flow.
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

- [x] Host/org mismatch UX (guide user to correct tenant domain).
- [x] Cross-subdomain auth/session UX:
  - [x] Define centralized entrypoint host (`app.vivd.studio`) behavior.
  - [x] Redirect authenticated users to active tenant host (`{org}.vivd.studio`) when appropriate.
  - [x] Keep super-admin workflows available on super-admin host(s) without accidental tenant pinning.
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
- [x] Enforce publish-domain allowlist checks server-side so users can only publish to org-approved domains.
- [x] Remove temporary preview org fallback (`__vivd_org`) after tenant-host routing stability window.

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
| Tenant entrypoint strategy | Central `app.vivd.studio` + redirect to active org host vs fully host-pinned only | In progress |
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
- `docs/tenant-subdomain-domain-governance-plan.md` - implementation plan for `app.vivd.studio` + `{org}.vivd.studio` and publish-domain governance.
- `docs/dokploy-traefik-wildcard-setup.md` - production steps for Dokploy + Traefik + Hetzner wildcard routing/certs.
- `docs/multi-tenant-refactor/organization-auth-plan.md` - org auth + superadmin plan.

---

*Last updated: 2026-02-12*
