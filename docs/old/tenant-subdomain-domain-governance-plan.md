# Tenant Subdomain + Domain Governance Implementation Plan

> Intent: implement host-based multi-tenant routing with automatic tenant subdomains, strict domain governance for publishing, and predictable org-switch behavior for multi-org users.

## Target Architecture Decisions

1. Central control-plane entrypoint is `app.vivd.studio`.
2. Every non-default org gets a managed tenant host: `{orgSlug}.vivd.studio`.
3. Tenant hosts pin org context by host; session `activeOrganizationId` is fallback only on control-plane hosts.
4. Publishing is allowlist-based: org members can publish only to domains explicitly enabled for their org.
5. `default` org remains internal/legacy and does not receive an auto-managed public tenant host.
6. Preview/share URLs should use tenant host URLs so `__vivd_org` fallback can be removed over time.
7. Super-admin authority remains a global user role (`user.role = super_admin`), not an organization-derived permission.
8. `default` org is a normal org for org-scoped access; membership in `default` does not grant super-admin authority.

## Authorization Boundary (Locked)

- Platform/super-admin operations require global `super_admin` role.
- Org operations require org membership roles (`owner`/`admin`/`member`).
- `default` org may include non-super-admin users and follows normal org permission rules.
- Super-admin routes remain host-gated on configured super-admin hosts.

## Current Gaps To Close

- Host-to-org resolution currently uses `published_site.domain`, not a dedicated domain registry.
- Publish accepts any syntactically valid globally-unique domain (no ownership/allowlist checks).
- Org switcher currently updates session org only; it does not perform cross-host navigation.
- Preview links still rely on `__vivd_org` fallback on shared host paths.
- No super-admin domain governance UI/API exists yet.

## Implementation Phases

## Phase 1: Data Model + Migration

### 1.1 Add `domain` table

Add a dedicated domain registry table in Drizzle schema + migration:

- `id` (text pk)
- `domain` (text unique, normalized lowercase, no `www.`)
- `organizationId` (fk to organization)
- `type` (`managed_subdomain` | `custom_domain`)
- `usage` (`tenant_host` | `publish_target`)
- `status` (`active` | `disabled` | `pending_verification`)
- `verificationMethod` (`dns_txt` | `http_file` | null)
- `verificationToken` (nullable)
- `verifiedAt` (nullable timestamp)
- `createdById` (nullable user fk)
- `createdAt`, `updatedAt`

Indexes:
- unique on `domain`
- `(organizationId, usage, status)`
- `(organizationId, type)`

### 1.2 Managed host backfill

Migration/backfill for existing orgs:
- For each org except `default`, insert `{org.slug}.vivd.studio` as:
  - `type=managed_subdomain`
  - `usage=tenant_host`
  - `status=active`
- Enforce global uniqueness and fail migration if collisions exist.

### 1.3 Reserved labels

Define reserved org slug labels (single source of truth, backend constant), e.g.:
- `app`, `www`, `api`, `admin`, `root`, `default`, `static`, `cdn`, `status`

Apply validation to:
- `superadmin.createOrganization`
- any future org slug update mutation (add one if not present)

## Phase 2: Host Resolution + Request Context

### 2.1 Create domain resolution service

Add backend service for:
- hostname normalization
- host classification (`control_plane_host`, `tenant_host`, `published_domain`, `unknown`)
- super-admin host flag resolution (`isSuperAdminHost`) from host allowlist config
- domain table lookup

### 2.2 Update tRPC context resolution

Refactor `createContext`:
- Resolve org from `domain` table first for `tenant_host` / `published_domain`.
- Keep super-admin host allowlist logic.
- Keep session `activeOrganizationId` fallback for control-plane hosts only.
- Expose host metadata in context:
  - `requestHost`
  - `hostOrganizationId`
  - `hostKind`
  - `isSuperAdminHost`
  - `canSelectOrganization` (derived, not duplicated across layers)

### 2.3 Update config API

Extend `config.getAppConfig` response with host info needed by frontend routing decisions:
- `isSuperAdminHost`
- `hostKind`
- `canSelectOrganization`
- `tenantHostOrgSlug` (nullable)

## Phase 3: Publish Governance Enforcement

### 3.1 Enforce org-enabled domains in backend

Before `checkDomain` and `publish` success:
- Domain must be present in `domain` table for that org.
- Domain must have `usage=publish_target`.
- Domain must have `status=active`.

If not, return explicit error:
- `Domain is not enabled for this organization`.

### 3.2 Keep uniqueness and conflict checks

Retain existing global uniqueness logic (`published_site`) but run after allowlist check.

### 3.3 Custom domain verification (foundation)

Create minimal API and status model for verification:
- create verification token
- show required DNS TXT / HTTP challenge value
- mark verified when challenge passes

Do not auto-enable unverified custom domains.

## Phase 4: Super-Admin Domain Operations

### 4.1 New super-admin tRPC procedures

Add procedures:
- `listOrganizationDomains(organizationId)`
- `addOrganizationDomain(organizationId, domain, usage, type)`
- `setOrganizationDomainStatus(domainId, status)`
- `setOrganizationDomainUsage(domainId, usage)`
- `startDomainVerification(domainId)`
- `checkDomainVerification(domainId)`
- `removeOrganizationDomain(domainId)` (guard against deleting active tenant host)

### 4.2 Super-admin UI

Add a domains section in org admin/superadmin UI:
- per-org domain table
- usage and status badges
- verification state
- enable/disable controls
- add domain dialog

Managed tenant host should appear read-only by default (except disable/replace flow guarded by warnings).

## Phase 5: Org Switcher + Cross-Host Navigation

### 5.1 Host-aware switch behavior

On control-plane host (`app.vivd.studio`):
- `setActiveOrganization` persists session org
- then redirect browser to `https://{orgSlug}.vivd.studio/vivd-studio`

On tenant host:
- current org is pinned by host
- switcher action navigates directly to target tenant host URL (no pinned-host mutation call first)

### 5.2 Mismatch handling

If logged-in user opens tenant host for org they are not a member of:
- show clear “wrong tenant host” state
- link back to `app.vivd.studio` (or logout)

### 5.3 Super-admin visibility rules

Super-admin UI remains host-gated and should not appear on tenant hosts unless explicitly allowed.

## Phase 6: Preview URL Canonicalization

### 6.1 Generate tenant-host preview links

Update frontend preview copy/share links to produce canonical URLs:
- `https://{orgSlug}.vivd.studio/vivd-studio/api/preview/{slug}/v{version}/`

### 6.2 Keep temporary compatibility

Backend preview endpoint may keep `__vivd_org` fallback during migration, but:
- prefer host-derived org
- log when fallback is used
- remove fallback after rollout stability window.

## Phase 7: Rollout + Backward Compatibility

### 7.1 Feature flag rollout

Add runtime flags:
- `TENANT_BASE_DOMAIN=vivd.studio`
- `CONTROL_PLANE_HOST=app.vivd.studio`
- `TENANT_DOMAIN_ROUTING_ENABLED=true`

Roll out in order:
1. DB migrations + backfill
2. read-path host resolution
3. UI switcher redirects
4. publish allowlist enforcement

### 7.2 Existing installs

For pre-existing published domains:
- backfill `domain` rows from `published_site` with `usage=publish_target`
- keep them active to avoid breaking existing customer traffic.

### 7.3 Observability

Add logs/metrics:
- host resolution result (`hostKind`, `organizationId`, fallback path used)
- publish denied by allowlist
- domain verification attempts
- cross-host switch redirects

## Phase 8: Local Development Parity

### 8.1 Local host strategy

Run local development with host-based routing enabled (not only `localhost`):
- Preferred (no external DNS required):
  - Control plane: `app.localhost`
  - Tenant hosts: `{orgSlug}.localhost`
- Alternative (requires public DNS resolution): `app.127.0.0.1.nip.io` + `{orgSlug}.127.0.0.1.nip.io`
- Keep bare `localhost` support as compatibility fallback, but treat wildcard local domains as primary test path.

### 8.2 Local auth/session behavior

Verify cross-subdomain session behavior in local mode:
- Cookie domain/same-site configuration supports `app.*` <-> `{org}.*` navigation.
- Login on control-plane host keeps user authenticated after tenant-host redirect.
- Logout invalidates session across control-plane and tenant hosts.

### 8.3 Local verification checklist

Add smoke checks to local runbook:
- Control-plane host resolves and loads `/vivd-studio`.
- Tenant host resolves and pins org context by host.
- Org switch from control-plane triggers cross-host redirect.
- Super-admin route guard only works on configured super-admin hosts.

## Acceptance Criteria

- New org creation auto-creates active `tenant_host` domain `{orgSlug}.vivd.studio` (except `default`).
- Reserved slug list is enforced in org creation.
- Visiting `https://{orgSlug}.vivd.studio/vivd-studio` pins org context to that org.
- Org switch from `app.vivd.studio` redirects user to selected tenant host.
- On tenant host, switching org opens target tenant host (not same-host context mutation).
- Publishing to a non-enabled domain fails server-side.
- Super-admin can view/manage org domain allowlist and verification status.
- Preview links no longer require `__vivd_org` for normal tenant-host usage.

## Suggested Work Breakdown (Ticket Order)

1. Schema + migration: `domain` table + reserved labels backend constant.
2. Domain service + `createContext` host resolution refactor.
3. Publish allowlist enforcement in `checkDomain`/`publish`.
4. Super-admin domain APIs + basic domain UI.
5. Org switcher cross-host behavior + mismatch UX.
6. Preview URL canonicalization + fallback deprecation.
7. Rollout flags, logging, migration cleanup.

## File Touchpoints (Expected)

- Backend:
  - `packages/backend/src/db/schema.ts`
  - `packages/backend/drizzle/*` (new migration)
  - `packages/backend/src/trpc.ts`
  - `packages/backend/src/services/PublishService.ts`
  - `packages/backend/src/routers/project/publish.ts`
  - `packages/backend/src/routers/superadmin.ts`
  - `packages/backend/src/routers/config.ts`
  - `packages/backend/src/server.ts`
- Frontend:
  - `packages/frontend/src/components/shell/AppSidebar.tsx`
  - `packages/frontend/src/lib/AppConfigContext.tsx`
  - `packages/frontend/src/components/projects/listing/ProjectCard.tsx`
  - super-admin org components under `packages/frontend/src/components/admin/organizations/`
- Docs:
  - `docs/PROJECT_STATE.md` (keep roadmap checkpoints in sync)
