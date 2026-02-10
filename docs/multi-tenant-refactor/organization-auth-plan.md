# Organization Auth + Super-Admin Plan (Multi-Tenant)

> **Intent:** Keep the current “Vivd Studio on `/vivd-studio`” UX, but make it **multi-tenant** with **invite-only onboarding** and a **super-admin control panel** that provisions orgs/users and sets per-org limits.

## Goals

- No public self-registration (no “anyone can sign up”).
- **Super-admin** can create:
  - Organizations
  - Initial org owner/admin users
  - Per-org limits and suspension
- Org admins can invite/manage members for their org.
- Strong tenant isolation:
  - Backend queries scoped by org (`organization_id`)
  - Object storage paths namespaced by org
  - Publishing domain uniqueness enforced server-wide, but still owned by an org
- Users can open studio from **their own domain**: `https://<published-domain>/vivd-studio`.

## Non-goals (v1)

- Billing (Stripe) and plan automation.
- Multi-org membership for normal users (we can enable later).
- Full Postgres RLS (app-layer scoping first; RLS can be a later hardening step).

---

## Tenancy model

- **Organization = Tenant**.
- We keep a **default organization** (our internal tenant) that represents the current single-tenant install (“the tenant we use ourselves”).
- “Tenant context” is resolved **per request**:
  - Prefer **Host-based** org resolution when a request comes from a published domain.
  - Otherwise, use the session’s active org (single-org UX by default).

### Tenant resolution rules (recommended hybrid)

1. **If Host matches a published domain** (in `published_site.domain`):
   - `tenantId := published_site.organization_id`
   - Require the signed-in user to be a member of that org (or super-admin).
2. **Else** (control-plane host / unknown host):
   - `tenantId := session.activeOrganizationId`
   - If missing, and user has exactly one org membership, auto-set it.
3. **Host/org mismatch**
   - If a user is logged in but their active org doesn’t match the domain’s org: deny access + guide to correct domain.

This keeps `https://<domain>/vivd-studio` working, while also supporting a “main studio host” (e.g. `vivd.studio/vivd-studio`) for onboarding and fallback.

---

## Roles & permissions

### Global role (user table)

- `super_admin`: can access super-admin panel and cross-tenant operations.
- `user` (default): regular identity, no cross-tenant privilege.

`super_admin` should be the only role allowed to use Better Auth’s **admin plugin** endpoints (set `adminRoles: ["super_admin"]`).

### Org role (organization_member.role)

- `owner`: full org control (incl. member management, domains, limits-view, destructive ops).
- `admin`: manage projects + publish + invite members.
- `member`: edit/use studio, no org admin functions.
- `client_editor`: constrained access (only assigned project(s)).

> Note: The current `client_editor` behavior can remain, but must become **org-scoped** (e.g. `project_member` rows include `organization_id`).

---

## Authentication & onboarding flows

### 1) Bootstrap (first install only)

If no users exist:
- Allow the existing “First Time Setup” flow to create the first user.
- That first user becomes:
  - `user.role = "super_admin"`
  - Member of the **default organization** with org role `owner`
- After bootstrap, public signup is blocked.

### 2) Normal login

- Email/password login remains.
- After login:
  - If `session.activeOrganizationId` is missing, pick the user’s only org.
  - Enforce Host/org mismatch rules when on a tenant domain.

### 3) Super-admin provisioning (new customer org)

In super-admin panel:
1. Create organization (name, slug, initial limits, status=active)
2. Create initial org owner/admin user
3. Attach user to organization as `owner` (or `admin`)
4. Set a password directly (no email/invite flow in v1):
   - Show a one-time temporary password to copy/share
   - (Optional later) force password reset/change on first login

### 4) Org admin adds members (password set)

We want “no public signup”, and we also want to keep v1 simple:
- Org admin creates users directly (email + name + password) and assigns org role.
- New user logs in on their org domain and is automatically placed into that org (no org picker).

(Later) We can add “invite-only signup” + email links once SES is in place.

---

## Super-admin panel access strategy

Requirements:
- Must not be discoverable/usable from tenant domains.
- Must be hard-gated server-side.

Implemented (v1):
- Route: `GET /vivd-studio/admin` (frontend, super-admin only) + tRPC `superadmin.*` (backend)
- Allowed hosts: `SUPERADMIN_HOSTS` (env, defaults to main `DOMAIN`) — **decided:** only default-tenant host(s)
- Guard conditions:
  - `user.role === "super_admin"`
  - request Host is in allowed hosts list

Optional hardening:
- IP allowlist / VPN-only for super-admin routes.
- Separate dedicated admin host (e.g. `admin.vivd.studio`).

---

## Data model changes (DB)

### New tables (minimum)

- `organization`
  - `id`, `name`, `slug`, `status`, `limits`, `created_at`, `updated_at`
- `organization_member`
  - `id`, `organization_id`, `user_id`, `role`, `created_at`
- `organization_invitation`
  - `id`, `organization_id`, `email`, `role`, `status`, `inviter_id`, `expires_at`, `created_at`
- `domain` (optional early; can be deferred if `published_site` is the only domain registry)
  - global domain registry: `domain` unique across server, ownership by org, verification state

### Existing tables (add org scoping)

Add `organization_id` to:
- `project_meta`, `project_version`, `project_publish_checklist`
- `project_member`
- `published_site` (keep `domain` globally unique)
- `usage_record`, `usage_period`

Add session org selection:
- `session.active_organization_id` (or plugin-provided equivalent)

### Storage & filesystem

- Bucket layout already supports: `tenants/<tenantId>/projects/<slug>/...`
  - Set `tenantId := organization.id` everywhere (backend + studio machine)
- Published materialization dir must be tenant-safe:
  - change from `/srv/published/<projectSlug>` to `/srv/published/<orgId>/<projectSlug>`

---

## Row-level separation checklist (what’s scoped vs global)

Tenant-scoped (must include `organization_id` and be filtered in every query):
- Projects + versions + publish checklist
- Usage records/periods
- Project member assignments
- Published site ownership (even though domain uniqueness is global)
- Studio machine registry / orchestration metadata

Global (server-wide):
- Better Auth identity tables (`user`, `session`, `account`, `verification`)
- Domain uniqueness constraint (the “name” must be unique across all orgs)
- Super-admin audit log (optionally global; entries still reference org)

---

## Migration plan (current single-tenant → default org)

1. Create a “default” organization (e.g. `id = "default"`).
2. Add org columns to tenant-scoped tables; backfill all existing rows with `organization_id = "default"`.
3. Create membership rows for all existing users in the default org:
   - map current permissions into org roles (admin → owner/admin; others → member/client_editor)
4. Promote the current admin user to `super_admin`:
   - safest: a one-time maintenance action “Promote me to super-admin” gated by:
     - you are an existing admin in default org AND
     - no super-admin exists yet
5. Update object-storage prefixes and publish materialization paths to include org ID.

---

## Risks & mitigations

- **Risk:** User logs into the “wrong” tenant domain and sees confusing errors.
  - Mitigation: explicit Host/org mismatch page with a link to the correct domain.
- **Risk:** Missing org filters in DB queries → data leak.
  - Mitigation: centralize org scoping helpers, add lint/test coverage, add an audit log for cross-tenant reads in super-admin mode.
- **Risk:** Domain takeover (org claims domain they don’t own).
  - Mitigation: introduce domain verification (DNS TXT or HTTP file challenge) before allowing publish to non-local domains.
- **Risk:** Cookie/session separation across unrelated custom domains.
  - Mitigation: accept that sessions are per-domain; provide “main studio host” as canonical login fallback.

---

## Open questions

- Do we want to add “invite-only signup” later (email links + accept-invite flow), or keep “admins create users” permanently?
- Should super-admin be able to impersonate an org member (Better Auth admin plugin supports impersonation)?
- Do we want a dedicated `domain` table early, or treat `published_site` as the first domain registry?
