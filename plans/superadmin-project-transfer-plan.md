# Super Admin Project Transfer Plan

Status: Proposed  
Last updated: 2026-02-22

## Goal

Allow a superadmin to move a project from one organization (tenant) to another, with an optional inline "create new organization and move" flow.

After a successful transfer:

- The project exists only in the target organization.
- Project DB state is moved to the target organization.
- Project bucket artifacts are moved to the target organization prefix.

## V1 Scope

- Transfer one project at a time.
- Support two target modes:
  - existing organization
  - new organization (created during the transfer)
- Support optional target slug (default: keep source slug).
- Move project-scoped DB records and bucket data.
- Require the project to be unpublished before transfer (v1 safety rule).
- Expose a dry-run/preflight response before execution.

## Non-Goals (V1)

- Auto-migrating active published-domain routing/Caddy config.
- Moving full org-level configuration, members, or limits.
- Building a background jobs framework (v1 can stay synchronous).

## Data Surface To Move

Project-scoped records tied to `(organization_id, project_slug)`:

- `project_meta` (source row removed after cutover)
- `project_version`
- `project_publish_checklist`
- `project_plugin_instance`
- `contact_form_submission`
- `plugin_entitlement` where `scope='project'`
- `usage_record` where `project_slug=<slug>` (recommended default: move)

Project access rows:

- `project_member` rows for source org/slug should be deleted in v1 (no automatic member remap across orgs).

Rows that must not remain in source org after success:

- source `project_meta` row for slug
- source bucket prefix `tenants/<sourceOrg>/projects/<slug>/`

## Storage Surface To Move

Bucket move:

- From: `tenants/<sourceOrg>/projects/<sourceSlug>/`
- To: `tenants/<targetOrg>/projects/<targetSlug>/`

This prefix includes version artifacts (`source`, `preview`, `published`, `thumbnails`) and OpenCode storage (`opencode/...`).

Local FS best-effort move (for local-provider compatibility):

- `projects/tenants/<sourceOrg>/<sourceSlug>/` -> `projects/tenants/<targetOrg>/<targetSlug>/`

## Key Constraint (Why Copy+Cutover Is Needed)

`project_meta` is keyed by `(organization_id, slug)` and referenced by multiple FKs without `ON UPDATE CASCADE`.  
That means in-place key updates are fragile. V1 should use a copy+cutover approach in a transaction:

1. Insert target `project_meta`.
2. Copy dependent rows (`project_version`, `project_publish_checklist`).
3. Repoint rows that can be updated safely (`project_plugin_instance`, `contact_form_submission`, entitlements, usage records).
4. Delete source `project_meta` (cascade removes old version/checklist rows).

## API Shape (Backend)

Add superadmin endpoints in `packages/backend/src/trpcRouters/superadmin.ts`:

- `superadmin.transferProjectDryRun` (query or mutation)
- `superadmin.transferProject` (mutation)

Input sketch:

- `sourceOrganizationId: string`
- `sourceProjectSlug: string`
- `targetMode: "existing" | "new"`
- `targetOrganizationId?: string` (existing mode)
- `newOrganization?: { slug: string; name: string }` (new mode)
- `targetProjectSlug?: string`
- `moveUsageRecords?: boolean` (default true)
- `confirmationText: string`

Response sketch:

- `success: boolean`
- `targetOrganizationId`
- `targetProjectSlug`
- `summary: { dbRowsMoved, bucketObjectsCopied, bucketObjectsDeleted }`
- `warnings: string[]`

## Transfer Sequence

1. Validate input and confirmation text.
2. Acquire transfer lock (recommended: Postgres advisory lock keyed by source/target).
3. Load source manifest and fail if project is published.
4. Resolve target org (existing or create-new intent) and target slug collision checks.
5. Stop studio machines for all source project versions.
6. Copy bucket prefix source -> target (fail fast on copy errors).
7. Execute DB cutover transaction:
   - create target org if requested
   - ensure managed tenant domain for new org
   - insert target project metadata
   - copy versions/checklists
   - move plugin/contact/entitlement/usage rows
   - delete source project members for slug
   - delete source `project_meta` row
8. Move local tenant project directory (best-effort).
9. Delete source bucket prefix (best-effort) and return warnings if cleanup fails.

## Failure Handling

- Failure before DB transaction commit: source remains authoritative.
- If bucket copy succeeded but DB cutover fails: attempt best-effort cleanup of target prefix and return explicit warning if cleanup fails.
- If DB commit succeeds but source-prefix delete fails: return success with cleanup warning; project remains functional from target.

## Frontend Plan (Super Admin)

Add a project transfer action in Super Admin organization management:

- Source org + project selector.
- Target mode toggle:
  - "Existing org"
  - "Create new org and move"
- Optional target slug.
- Preflight summary (rows + object count + warnings).
- Dangerous-action confirmation input.

Recommended placement:

- new "Projects" panel in `packages/frontend/src/components/admin/organizations`.

## Tests

Backend:

- service tests for preflight validation and transfer sequencing.
- router tests for:
  - existing-org move success
  - create-new-org+move success
  - target slug collision rejection
  - published project rejection
  - bucket-copy failure abort behavior

Storage:

- tests for new prefix-copy utility (pagination, metadata preservation, partial-failure reporting).

Frontend:

- tests for transfer dialog mode switching, validation, dry-run rendering, and execute mutation wiring.

## Rollout

1. Ship behind `VIVD_SUPERADMIN_PROJECT_TRANSFER_ENABLED` (add to `.env.example`).
2. Enable for internal superadmin testing first.
3. Validate with one non-production org-to-org transfer (existing target + create-new target).
4. Enable by default after verification.

## Open Decisions

- V1 requirement to be unpublished first: keep strict, or also support moving published routing.
- Usage migration default: move project-scoped usage records vs keep historical usage with source org.
- Project-member behavior: keep v1 "remove and manually reassign" vs partial automatic remap.
