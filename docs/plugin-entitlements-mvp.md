# Plugin Entitlements MVP (Superadmin-Managed, Cost-Controlled)

Status: proposed (2026-02-22)

## Goal

Provide a single superadmin control surface to enable/disable Contact Form for any customer project without navigating into each organization, while enforcing cost controls at runtime.

## Scope (MVP)

- Superadmin-managed access only (no self-serve enable yet).
- Contact Form only (`plugin_id = "contact_form"`).
- Central superadmin list and toggle actions across all organizations/projects.
- Runtime enforcement for:
  - whether plugin is allowed (entitled),
  - optional monthly submission cap (hard stop).

## Non-Goals (MVP)

- Plan-billing automation.
- Per-seat billing logic.
- Complex approvals/workflows.

## Data Model

### 1) `plugin_entitlement`

Single source of truth for plugin access state.

Columns:

- `id text primary key`
- `organization_id text not null references organization(id) on delete cascade`
- `project_slug text null`  
  `NULL` means org-scope entitlement; non-NULL means project override.
- `plugin_id text not null`  
  Current allowed value: `contact_form`.
- `state text not null default 'disabled'`  
  Values: `disabled | enabled | suspended`.
- `managed_by text not null default 'manual_superadmin'`  
  Values: `manual_superadmin | plan | self_serve`.
- `monthly_event_limit integer null`  
  `NULL` = unlimited.
- `hard_stop boolean not null default true`
- `notes text not null default ''`
- `changed_by_user_id text null references "user"(id) on delete set null`
- `created_at timestamp not null default now()`
- `updated_at timestamp not null default now()`

Indexes and constraints:

- `index(plugin_entitlement_org_plugin_idx) on (organization_id, plugin_id)`
- `index(plugin_entitlement_state_idx) on (plugin_id, state)`
- unique partial index for org scope:  
  `unique (organization_id, plugin_id) where project_slug is null`
- unique partial index for project scope:  
  `unique (organization_id, project_slug, plugin_id) where project_slug is not null`
- check constraint: `plugin_id in ('contact_form')` (or skip and validate in service for forward compatibility).

### 2) `plugin_enable_request` (optional but recommended)

Keeps request queue out of ad-hoc messages and supports future self-serve handoff.

Columns:

- `id text primary key`
- `organization_id text not null references organization(id) on delete cascade`
- `project_slug text not null`
- `plugin_id text not null`
- `status text not null default 'pending'`  
  Values: `pending | approved | rejected | cancelled`.
- `requested_by_user_id text not null references "user"(id) on delete restrict`
- `request_note text not null default ''`
- `reviewed_by_user_id text null references "user"(id) on delete set null`
- `review_note text not null default ''`
- `reviewed_at timestamp null`
- `created_at timestamp not null default now()`
- `updated_at timestamp not null default now()`

Indexes:

- `index(plugin_enable_request_org_project_idx) on (organization_id, project_slug, plugin_id)`
- `index(plugin_enable_request_status_idx) on (status, created_at)`
- partial unique (optional): one pending request per org/project/plugin.

## Entitlement Resolution Rules

For `(organization_id, project_slug, plugin_id)`:

1. If project-scope row exists in `plugin_entitlement`, use it.
2. Else if org-scope row exists (`project_slug is null`), use it.
3. Else treat as `disabled`.

Effective state gates runtime behavior.

## Runtime Enforcement

### A) Control-plane plugin enable action

`plugins.contactEnsure` must require:

- caller is superadmin, and
- effective entitlement state is `enabled`.

This prevents accidental plugin provisioning without commercial approval.

### B) Public submit endpoint (`POST /plugins/contact/v1/submit`)

Before delivery:

- resolve effective entitlement by plugin instance `(organizationId, projectSlug, pluginId)`,
- if state is not `enabled`, return `403` with `plugin_not_entitled`,
- if `monthly_event_limit` is set and `hard_stop=true`, count current-month `contact_form_submission` and block with `429` `plugin_quota_exceeded` when limit reached.

MVP metering source: `contact_form_submission` table (existing index supports org/project/time lookups).

## tRPC Contract (MVP)

All superadmin procedures are in `superadmin` router.

### `superadmin.pluginsListAccess` (query)

Input:

- `pluginId?: "contact_form"`
- `search?: string` (matches org slug/name/project slug)
- `state?: "enabled" | "disabled" | "suspended"`
- `organizationId?: string`
- `limit?: number` default `100`, max `500`
- `offset?: number` default `0`

Output row:

- `organizationId`
- `organizationSlug`
- `organizationName`
- `projectSlug`
- `projectTitle`
- `effectiveScope: "project" | "organization" | "none"`
- `state: "enabled" | "disabled" | "suspended"`
- `managedBy`
- `monthlyEventLimit`
- `hardStop`
- `usageThisMonth`
- `projectPluginStatus: "enabled" | "disabled" | null`
- `updatedAt`

### `superadmin.pluginsUpsertEntitlement` (mutation)

Input:

- `pluginId: "contact_form"`
- `organizationId: string`
- `scope: "organization" | "project"`
- `projectSlug?: string` (required when `scope=project`)
- `state: "enabled" | "disabled" | "suspended"`
- `monthlyEventLimit?: number | null`
- `hardStop?: boolean` default `true`
- `notes?: string`

Behavior:

- upsert entitlement row,
- stamp `changed_by_user_id`,
- if `state=enabled` and `scope=project`, call `ensureContactFormPlugin` to provision plugin instance immediately.

### `superadmin.pluginsBulkSetForOrganization` (mutation)

Input:

- `pluginId: "contact_form"`
- `organizationId: string`
- `state: "enabled" | "disabled" | "suspended"`
- `monthlyEventLimit?: number | null`
- `hardStop?: boolean`
- `notes?: string`

Behavior:

- writes org-scope entitlement once; all projects inherit unless project override exists.

### `superadmin.pluginsListRequests` (query) (optional)

Input:

- `status?: "pending" | "approved" | "rejected" | "cancelled"`
- `pluginId?: "contact_form"`
- `organizationId?: string`
- `limit?: number`
- `offset?: number`

### `superadmin.pluginsReviewRequest` (mutation) (optional)

Input:

- `requestId: string`
- `decision: "approved" | "rejected"`
- `reviewNote?: string`
- `enableNow?: boolean` default `true`

Behavior:

- marks request reviewed,
- if approved and `enableNow=true`, calls `pluginsUpsertEntitlement(state=enabled, scope=project, ...)`.

## Superadmin UI (MVP)

Add a new Super Admin tab: `Plugins`.

Main table:

- org
- project
- status
- usage this month
- limit
- plugin instance status
- updated at
- actions (`Enable`, `Disable`, `Suspend`, `Set limit`)

Features:

- search by org/project,
- filter by status,
- fast per-row actions,
- org-scope quick action to enable/disable all inherited.

## Backward Compatibility and Rollout

1. Add tables and service code behind a feature flag (optional).
2. Backfill:
   - for existing enabled `project_plugin_instance` rows (`contact_form`), create project-scope entitlements with `state=enabled`, `managed_by=manual_superadmin`, note `backfilled`.
3. Deploy enforcement with temporary fallback:
   - if no entitlement row exists but plugin instance is enabled, allow temporarily and log warning.
4. Remove fallback after backfill validation.

## Future Plan-Based Self-Serve

No schema rewrite needed:

- billing system writes org-scope `plugin_entitlement` rows (`managed_by=plan`),
- project page can expose self-serve enable only when entitlement permits it,
- same runtime gate remains authoritative.

