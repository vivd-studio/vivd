# Project Slug Rename Plan

Status: Proposed  
Last updated: 2026-02-24

## Goal

Allow operators to rename a project's slug within the same organization while preserving all project data, history, artifacts, and runtime behavior.

After a successful rename:

- The project is addressable only by the new slug.
- Project DB records reference the new slug.
- Bucket and local filesystem project prefixes are moved to the new slug.
- Control-plane routes use the new slug.

## V1 Scope

- Rename one project at a time.
- Same-organization rename only.
- Require project to be unpublished before rename (v1 safety rule).
- Move project-scoped DB records and storage prefixes (`tenants/<org>/projects/<slug>/`).
- Expose in control-plane project actions (dashboard + fullscreen/embedded project views).
- Return dry-run style warnings in mutation response when cleanup is best-effort.

## Non-Goals (V1)

- Cross-organization moves (handled separately by `docs/superadmin-project-transfer-plan.md`).
- Renaming organization slugs.
- Renaming while a project is actively published.
- Background jobs/work queues for rename (v1 stays synchronous).

## Data Surface To Move

Project-scoped rows tied to `(organization_id, project_slug)`:

- `project_meta` (key changes from old slug to new slug)
- `project_version`
- `project_publish_checklist`
- `project_plugin_instance`
- `contact_form_submission`
- `analytics_event`
- `project_member`
- `plugin_entitlement` where `scope='project'`
- `usage_record` where `project_slug=<oldSlug>`

Rows expected to be absent in v1 rename execution:

- `published_site` for source slug (rename is blocked when published)

## Storage Surface To Move

Bucket prefix move:

- from: `tenants/<organizationId>/projects/<oldSlug>/`
- to: `tenants/<organizationId>/projects/<newSlug>/`

Local filesystem move (best-effort for local-provider compatibility):

- `projects/tenants/<organizationId>/<oldSlug>/` -> `projects/tenants/<organizationId>/<newSlug>/`
- legacy fallback for default tenant path if present.

## Key Constraint

`project_meta` is keyed by `(organization_id, slug)` and referenced by FKs without `ON UPDATE CASCADE`.  
V1 should use copy+cutover in a transaction (not in-place PK update):

1. Insert target `project_meta` row (`newSlug`).
2. Copy dependent version/checklist rows to `newSlug`.
3. Repoint/update rows that store `project_slug`.
4. Delete source `project_meta` row (`oldSlug`) to remove stale dependents.

## API Shape (Backend)

Add mutation in `packages/backend/src/trpcRouters/project/maintenance.ts`:

- `project.renameSlug`

Input sketch:

- `oldSlug: string`
- `newSlug: string`
- `confirmationText: string` (must match `newSlug`)

Response sketch:

- `success: boolean`
- `oldSlug: string`
- `newSlug: string`
- `warnings: string[]`
- `summary: { dbRowsMoved: number; bucketObjectsCopied: number; bucketObjectsDeleted?: number }`

## Rename Sequence

1. Validate input and normalize slugs.
2. Acquire advisory lock for `(organizationId, oldSlug, newSlug)`.
3. Load source project and fail if missing.
4. Verify target slug does not already exist.
5. Verify source project is unpublished.
6. Stop studio machines for all source project versions.
7. Copy bucket prefix `oldSlug -> newSlug` (fail fast).
8. Execute DB cutover transaction:
   - insert target `project_meta`
   - copy `project_version`
   - copy `project_publish_checklist` (rewrite checklist JSON `projectSlug`)
   - update `project_plugin_instance`, `contact_form_submission`, `analytics_event`, `project_member`, `plugin_entitlement` (project scope), `usage_record`
   - delete source `project_meta`
9. Move local filesystem project dir (best-effort).
10. Delete source bucket prefix (best-effort); return warnings on cleanup failure.

## Frontend Plan

Add rename action + dialog in:

- `packages/frontend/src/components/projects/listing/ProjectCard.tsx`
- `packages/frontend/src/pages/ProjectFullscreen.tsx`
- `packages/frontend/src/pages/EmbeddedStudio.tsx`

Behavior:

- Validate slug format client-side.
- Call `trpc.project.renameSlug.useMutation`.
- On success:
  - invalidate `project.list` and slug-scoped queries
  - navigate to new slug route (`/vivd-studio/projects/<newSlug>`, preserving view/version query params when present)

## Studio/Shared Action Notes

- Keep project action parity in mind for connected-mode surfaces (`packages/shared/src/types/projectActions.ts` and Studio toolbar action menus).
- V1 can remain control-plane-first if Studio action parity is deferred explicitly.

## Tests

Backend:

- router/service tests for happy path, slug collision, source-not-found, and published-project rejection.
- transactional integrity test for complete slug migration across all slug-bearing tables.
- storage prefix copy utility tests (pagination, partial-failure handling, metadata preservation).

Frontend:

- rename dialog validation and mutation wiring tests.
- post-rename navigation + invalidation behavior tests.

## Rollout

1. Ship behind `VIVD_PROJECT_SLUG_RENAME_ENABLED` (add to `.env.example`).
2. Enable for internal operators first.
3. Validate with staging projects across URL-generated and scratch-generated sources.
4. Enable by default after verification.

## Open Decisions

- Should v1 allow rename for currently published projects by doing automatic unpublish/republish?
- Should rename be available in Studio quick actions in v1 or control-plane only?
