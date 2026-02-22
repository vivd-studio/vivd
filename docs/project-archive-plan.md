# Project Archive Feature Plan

Status: Proposed  
Last updated: 2026-02-22

## Goal

Add a reversible archive flow for projects so teams can remove inactive projects from day-to-day surfaces without permanently deleting files, versions, and metadata.

## Why This Matters

Current project cleanup is destructive (`project.delete`) and used from multiple UI surfaces. We need a safer lifecycle state that:

- keeps active dashboards clean,
- reduces accidental data loss,
- allows restoring old projects when needed.

## V1 Scope

- Add project lifecycle state: `active | archived`.
- Add explicit archive and unarchive actions.
- Hide archived projects from default project listings and selectors.
- Add a dedicated archived view/filter in project lists.
- Keep hard delete available as a separate, explicit destructive action.
- Block archive when the project is still published.
- Block archive when client editors are assigned to the project.

## Non-Goals (V1)

- Automatic retention cleanup / timed purge of archived projects.
- Bulk archive/unarchive.
- Archiving individual versions (this plan is project-level only).
- Background jobs framework for lifecycle transitions.

## Proposed Behavior

### Archive

- Allowed for org admins/users (same role scope as current delete).
- Preconditions:
  - project exists,
  - not currently published,
  - no `client_editor` assignment to that slug.
- Side effects:
  - stop studio machines for all project versions (best effort),
  - mark project as archived in DB,
  - leave filesystem and bucket artifacts untouched.

### Archived project restrictions

- Excluded from default `project.list` responses.
- Hidden from member assignment dropdowns (Team settings / Super Admin member editing).
- Cannot be published or have studio started until restored.
- Direct route access to archived projects should show archived state and restore CTA instead of normal editing path.

### Restore (Unarchive)

- Marks project back to `active`.
- No automatic studio boot or publish action.

### Hard delete

- Keep existing `project.delete` behavior.
- UI should move hard delete behind archived context (restore/archive first model), but backend API stays available for compatibility.

## Data Model Changes

### Schema

Add fields to `project_meta`:

- `lifecycle_status text not null default 'active'`
- `archived_at timestamp null`
- `archived_by_user_id text null` (`user.id`, `on delete set null`)

Indexes:

- `project_meta_org_lifecycle_updated_idx` on `(organization_id, lifecycle_status, updated_at desc)`

### Migration

- New migration file: `packages/backend/drizzle/0019_project_archive.sql`.
- Backfill existing rows to `lifecycle_status='active'`.

## Backend Implementation Plan

### Service Layer

Update `packages/backend/src/services/project/ProjectMetaService.ts`:

- `listProjects(organizationId, options)` with lifecycle filter.
- `getProject(organizationId, slug, options)` with includeArchived option.
- `archiveProject(...)` and `unarchiveProject(...)`.
- Update max-project count logic in `createProjectVersion` to count only active projects.

Update `packages/backend/src/generator/versionUtils.ts`:

- `listProjectSlugs(organizationId, options)` to support lifecycle filtering.
- Keep maintenance endpoints able to request `includeArchived: true`.

### tRPC procedures

Add project lifecycle procedures (new `project/lifecycle.ts` or `project/maintenance.ts`):

- `project.archive` mutation
- `project.unarchive` mutation

Extend `project.list` in `packages/backend/src/trpcRouters/project/generation.ts`:

- input filter: `{ state?: "active" | "archived" | "all" }`
- default: `active`

Add active-state guards for mutation/query paths that should not operate on archived projects:

- studio machine start/restart (`project/studio.ts`),
- publish checks (`project/publish.ts`),
- generation/regeneration entrypoints (`project/generation.ts`),
- member assignment checks in `organization.ts` and `superadmin.ts`.

### Super Admin and plugin surfaces

Update queries that currently load all `project_meta` rows:

- `superadmin.listOrganizationProjects`
- plugin access list (`PluginEntitlementService.listProjectAccess`)

Default to active projects and add optional includeArchived capability where needed.

## Frontend Plan

### Project list and cards

Update:

- `packages/frontend/src/components/projects/listing/ProjectsList.tsx`
- `packages/frontend/src/components/projects/listing/ProjectCard.tsx`
- `packages/frontend/src/components/projects/dialogs/DeleteProjectDialog.tsx`

Changes:

- Active/Archived filter control.
- Replace default destructive action with archive for active projects.
- Show restore action for archived projects.
- Keep hard delete as secondary destructive action in archived context.

### Fullscreen project pages

Update:

- `packages/frontend/src/pages/ProjectFullscreen.tsx`
- `packages/frontend/src/pages/EmbeddedStudio.tsx`

Changes:

- Replace delete quick action with archive/restore.
- Show archived-state guard UI when project is archived.

### Shared action registry

Update `packages/shared/src/types/projectActions.ts` with archive/restore actions so dashboard and studio toolbars stay aligned.

### Team/member assignment UI

Update project selectors to exclude archived projects:

- `packages/frontend/src/components/settings/TeamSettings.tsx`
- superadmin member/project selectors.

## Studio (Connected Mode) Plan

### Studio server proxy

Update `packages/studio/server/trpcRouters/project.ts`:

- add `archiveProject` and `unarchiveProject` proxy mutations.
- keep `deleteProject` compatibility, but align payload with backend (`confirmationText`) if retained.

### Studio client toolbar

Update:

- `packages/studio/client/src/components/preview/toolbar/useToolbarState.ts`
- `packages/studio/client/src/components/preview/toolbar/components/QuickActions.tsx`
- `packages/studio/client/src/components/preview/toolbar/components/MobileActionsMenu.tsx`

Changes:

- connected-mode archive/restore actions and confirmation dialogs,
- remove default one-click hard-delete flow.

## Testing Plan

### Backend

- Router tests for archive/unarchive success and failures:
  - published project rejection,
  - assigned client-editor rejection,
  - list filtering by lifecycle state.
- Service tests for:
  - lifecycle state transitions,
  - active-only project limit counting.

### Frontend

- `ProjectsList` tests for state filter and action visibility.
- `ProjectCard` tests for archive/restore and destructive-action gating.
- Fullscreen/embedded tests for archived-state guard behavior.

### Studio

- Studio router proxy tests for archive/unarchive mutation mapping.
- Toolbar tests for connected-mode action rendering and mutation dispatch.

## Rollout

1. Add backend + DB support behind `VIVD_PROJECT_ARCHIVE_ENABLED` (default `false`).
2. Ship frontend/studio UI with feature-flag checks.
3. Enable in staging and validate:
   - archive -> hidden from active list,
   - restore -> visible again,
   - publish/studio restrictions hold.
4. Enable by default after validation.

## Open Decisions

- Should archived projects count against `maxProjects`?  
  Proposed: no (count only active projects).
- Should hard delete require archived state first at API level?  
  Proposed for v1 UI only; enforce at API level in v2.
- Should superadmin plugin/project tables show archived rows by default?  
  Proposed: hidden by default, optional include filter.
