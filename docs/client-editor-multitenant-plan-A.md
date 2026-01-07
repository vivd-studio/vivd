# Client Editor (Multi-tenant) Plan

Enable a “multi-tenant-lite” mode where multiple simple websites can be hosted in **one** Vivd instance, but end customers can only access and edit **their own** website via `/{domain}/vivd-studio`, without any AI capabilities.

This is primarily **RBAC + access scoping**, not “AI usage licensing”.

## Goals

- Add a restricted user role (recommended name: **Client Editor**, `client_editor`).
- Scope that role to **exactly one** published domain + project (and optionally version rules).
- Ensure **server-side enforcement** (no “UI-only” protection).
- Remove/disable AI features for this role (agent, checklist/fix, AI images).
- Allow non-AI editing: text edits + file/image upload + drag&drop swapping.

## Non-goals (v1)

- True multi-tenant isolation for the AI agent (requires per-tenant instances or strong sandboxing).
- Per-user AI token metering/billing.
- Multi-site access per client user (possible later as an ACL change).

## Proposed role + capability model

### Roles

- `admin`: full access (existing).
- `user`: full studio access for the instance (current default).
- `client_editor`: **domain-scoped editor**, no AI features.

Optional future split:
- `client_owner`: like `client_editor` + publish/unpublish permission (decision needed).

### Capabilities (v1)

Allowed for `client_editor`:
- Inline text edits via `project.applyHtmlPatches` (`backend/src/routers/project/maintenance.ts`).
- Asset browser + delete via `assetsFilesystemProcedures` (`backend/src/routers/assets/filesystem.ts`).
- Upload images/files via upload endpoint (`backend/src/server.ts`).

Disallowed for `client_editor`:
- Agent chat / sessions (`backend/src/routers/agent/sessions.ts`).
- Pre-publish checklist + “Fix this” (`backend/src/routers/agent/checklist.ts`).
- AI image endpoints (`backend/src/routers/assets/aiImages.ts`).
- (Recommended) project generation/regeneration endpoints.

## Tenant / project scoping design (critical)

### Tenant selector

Use the **request host** (domain) as the tenant key.

- The browser is on `https://customer-domain.tld/vivd-studio/...`.
- The backend can read the host from request headers.

### Mapping to project

Use `published_site` as the source of truth (already maps `domain -> projectSlug/version`):
- `backend/src/db/schema.ts` (`published_site`)

### New DB link table (recommended)

Add `site_member` (or `site_access`) table to bind users to exactly one domain/project:

- `id`
- `userId` (FK `user.id`)
- `domain` or `publishedSiteId` (FK `published_site.id`)
- `role` (for future: editor/owner)
- `createdAt`

Enforcement rule:
- If `session.user.role === "client_editor"`, the user must have **exactly one** membership and it must match the current request host.

Why not just store `domain` on `user`?
- Keeps future “multiple sites per user” as a simple many-to-many extension.
- Avoids mixing tenant-scoping concerns into the core auth user row.

## Backend enforcement plan (must-have)

### 1) Keep request context in tRPC

Today `protectedProcedure` drops `req/res` from `ctx` in `backend/src/trpc.ts`. For host-based scoping, keep `req` (and/or normalized host) available in protected/admin procedures.

Add a helper:
- `getRequestHost(req)` that correctly reads `X-Forwarded-Host`/`X-Forwarded-Proto` when behind Caddy/Proxies.

### 2) Centralize authorization checks

Add a shared backend helper:

- `assertProjectAccess({ session, host, projectSlug })`
  - `admin`/`user`: allow (existing behavior).
  - `client_editor`: allow only if `host` matches assigned domain and assigned `projectSlug`.

Then create wrappers to avoid missing checks:
- `projectScopedProcedure` (like `adminProcedure`) that asserts access for any input containing `slug`/`projectSlug`.

### 3) Lock down all project/asset endpoints

Ensure these enforce project scoping (not just “logged in”):
- `project.list` (must return only assigned project for `client_editor`)
- `project.preview/get` endpoints that accept a slug
- `assets.*` (filesystem + AI)
- upload/download routes in `backend/src/server.ts` (accept slug/version)

### 4) Fix static file exposure in server.ts

Currently static serving is mounted for all authenticated users at:
- `/vivd-studio/api/projects` and `/vivd-studio/api/preview` in `backend/src/server.ts`

This is incompatible with multi-tenant mode because a `client_editor` could request other projects directly by URL.

Plan:
- Replace static mounts with authenticated handlers that:
  - resolve slug/version from path
  - call `assertProjectAccess(...)`
  - `safeJoin` into the version dir
  - stream the file

## Frontend plan (UX + safety-in-depth)

### Hide AI UI for client editors

Use `session.user.role` to hide:
- Chat panel / “Agent Chat” buttons (`frontend/src/components/chat/*`, `frontend/src/components/preview/PreviewToolbar.tsx`).
- Checklist + Fix UI (`frontend/src/components/PublishDialog.tsx` and `frontend/src/components/publish/*`).
- AI image actions (wherever AI image buttons exist).

Backend remains the source of truth; UI gating is a convenience.

### “Domain-only” access

For `client_editor`:
- On `/vivd-studio`, auto-navigate to the assigned project preview route (domain-resolved).
- Do not show a multi-project dashboard; behave like single-project mode.

## Admin workflow (v1)

Add an admin-only flow to:
- create a user with role `client_editor`
- assign them to a published domain/project (`site_member` row)

Initial simple assumption:
- only published sites can be edited by client editors (because domain is needed).

## Open decisions

- Publish rights:
  - Option A: `client_editor` can edit only; admin publishes/unpublishes.
  - Option B: add `client_owner` role for publish/unpublish (recommended if customers must self-publish).
- Project/version rules:
  - allow editing only the currently published version
  - or allow editing the “current” version and publishing is a separate step

## Licensing vs rights (recommendation)

This feature belongs under **rights/users/access scoping**, not the LicensingService:
- Licensing is a **server installation** entitlement layer (instance-level limits, AI on/off, monthly caps).
- Client Editor is an **RBAC + ACL** feature.

Keep v1 simple:
- disable all AI features for `client_editor` so token/image metering can stay **per instance**.

If AI images are later enabled for clients:
- prefer metering per **domain/site** first (aligns with tenant billing), then consider per-user only if necessary.

