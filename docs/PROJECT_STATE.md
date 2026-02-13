# Vivd Project State & Implementation Roadmap

> **Goal:** Run Vivd as a multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and reliable publish/preview flows.

This document is intentionally concise. It tracks what is still open and only keeps high-signal completed milestones.

Related checklist:
- `docs/refactoring-day-checklist.md` - maintainability/refactoring backlog.

Progress log:
- 2026-02-13: super-admin template maintenance now runs across all tenants (iterates every organization) instead of only the currently selected org.
- 2026-02-13: studio polling tuning — kept connected-studio workspace-state reporting default at 5s (configurable via `WORKSPACE_STATE_REPORT_INTERVAL_MS`) while retaining host-resolution log throttling to reduce backend log noise.
- 2026-02-13: publish prepared-time fix — prevented local studio bucket sync from overwriting `.vivd/build.json` so publish status reflects the latest save and doesn't revert.
- 2026-02-13: publish domain UX + gating fixes — allowed active tenant-host domains to be used for publish, added explicit allowlist denial reasons (missing/other-org/inactive), debounced publish-domain validation to reduce jitter, and surfaced user-friendly disabled-button reasons in publish dialogs (app shell + Studio).
- 2026-02-13: publish artifact metadata fix — ensured bucket build metadata includes `commitHash` for generated/imported artifacts and made git init commits reliable (prevents publish state from being stuck with “snapshot still being prepared” forever).
- 2026-02-13: publish improvements — added project-level `redirects.json` (validated + rendered into Caddy snippets), fixed extensionless `.html` routing, fixed `redir` directive generation, and switched template-file maintenance to bucket-only mode.
- 2026-02-13: tenant routing fixes — fixed host resolution precedence (active domains override `SUPERADMIN_HOSTS`), fixed canonical preview URLs, removed `__vivd_org` fallback, and reduced host-resolution log spam.
- 2026-02-13: studio sync hardening — ignore transient missing files during artifact upload, retry SDK sync before AWS CLI fallback, and fail with explicit diagnostics on missing CLI.
- 2026-02-12: tenant-domain governance — implemented `domain` registry + migration/backfill, host-based context resolution (`hostKind`), super-admin domain management UI, publish allowlist enforcement, tenant-host org switching + redirects, and canonical preview URLs.
- 2026-02-12: tenant routing stabilization — fixed prod lockout on base domain, org context fallback for studio machine calls, connected-studio 401s, cross-host org switching edge cases, and env propagation in compose deployments.
- 2026-02-12: bucket-first ZIP exports — made downloads object-storage-only, reintroduced "Download as ZIP" in studio toolbar, and triggered source-artifact sync after patch saves.
- 2026-02-12: documented Dokploy/Traefik wildcard setup runbook (`docs/dokploy-traefik-wildcard-setup.md`).
- 2026-02-11: studio reliability — added "Hard restart" for stale workspaces, Fly machine `replacing` state retry, serialized Git operations with `.git/index.lock` cleanup, and publish safeguards (block on unsaved changes / older snapshots).
- 2026-02-11: multi-org membership — enabled per-user multi-org with email-based auto-detect and session-based org switcher.
- 2026-02-11: misc — fixed bucket-first ZIP import with tenant isolation, optimized CI to build/push only changed images.
- 2026-02-10: admin cleanup — transaction safety for superadmin mutations, component splitting (`OrganizationsTab`, `AppSidebar`), reduced sidebar polling.

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
- [ ] Decide concurrency/locking model (single-writer lock vs optimistic; Git ops already serialized).
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
| Tenant entrypoint strategy | Central `app.vivd.studio` + redirect to active org host vs fully host-pinned only | Implemented |
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

*Last updated: 2026-02-13*
