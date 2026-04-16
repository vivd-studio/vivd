# End-User-Friendly Surface Plan

Date: 2026-04-16  
Owner: product UX / platform  
Status: proposed

## Recommendation

Adopt a hybrid visibility model instead of one blanket rule.

- Default product surfaces should use human-facing names, task language, and outcome-focused summaries.
- Read-only technical metadata should stay available, but only behind an explicit `Technical details` or `Debug details` disclosure.
- Operator controls, destructive maintenance actions, and raw runtime/config surfaces should move into dedicated admin panels and be server-enforced.
- When a surface is both useful and risky, default to hide-by-default plus deliberate reveal rather than showing raw implementation detail in the main flow.

This keeps support and debugging viable without making the normal product feel like a developer tool.

## Problem Statement

The current product still exposes implementation detail too directly in several high-traffic flows:

- snapshot/version history shows commit hashes and changed file paths in the main panel
- project pages often use the project slug as the primary visible name
- generic plugin pages expose runtime status, raw snippets, and JSON config to ordinary project members
- organization maintenance tooling is still mixed into normal admin surfaces
- publish UI still explains some actions in Git terms instead of user terms

These are not all the same problem. Some are copy issues, some are information architecture issues, and some are permission mismatches between frontend and backend.

## Principles

### Human-first language

Use the product term the user understands first:

- `Project name` before slug
- `Publish version` before tag
- `Technical details` instead of raw Git vocabulary in the primary flow

### Progressive disclosure

Technical detail can exist, but it should be deliberately opened. The default state should answer:

- what happened
- when it happened
- what the user can do next

without requiring the user to parse implementation data.

### Capability-based permissions

Read-only debugging detail and operator controls should not be treated the same:

- read-only technical detail can often be available to more people if deliberately revealed
- mutating maintenance and raw config surfaces should be admin-only, with superadmin as the safer default for the first pass

### Server-enforced policy

Frontend hiding alone is not enough. If a surface should be restricted, the backend contract must return only the allowed subset or reject access entirely.

### Shared patterns over one-off fixes

This should not become five unrelated UI tweaks. The repo already has good precedents for:

- server-provided UI allow flags
- collapsible technical detail panels
- explicit superadmin checks

The cleanup should extend those patterns consistently.

## Surface Model

### 1. Default User Surface

Shown in normal product flows.

Content should be:

- human-readable
- task-oriented
- safe for ordinary project members

Examples:

- project title
- publish status
- saved timestamp
- plugin setup progress
- simple version summaries such as `3 changes`

### 2. Revealed Technical Details

Hidden by default behind a clear disclosure.

Content can include:

- commit/tag identifiers
- changed file paths
- raw sync state
- runtime IDs
- low-level error payloads
- generated embed/code snippets when they are useful for support or debugging

This layer is mainly for support, power users, and troubleshooting.

### 3. Admin / Operator Surface

Visible only in dedicated admin panels, not mixed into the normal flow.

Content can include:

- maintenance actions
- destructive cleanup
- force-resync / repair actions
- raw plugin JSON editing
- secret-dependent or backend-operated integration controls

The first-pass policy should lean superadmin unless a clear org-admin use case is already proven.

## Priority Workstreams

### 1. Snapshot And Version History

Primary target:

- `packages/studio/client/src/components/projects/versioning/VersionHistoryPanel.tsx`

Plan:

- Replace visible hash-first labeling with user-facing version language.
- Show commit hashes only inside a collapsed technical section.
- Replace raw changed file paths in the main panel with summary text such as change counts or grouped labels.
- Keep GitHub sync, ahead/behind, repo, and branch detail behind the same technical disclosure pattern.
- Reuse the existing `uiAllowed` approach already present in Studio server responses for gated sync detail.

Desired result:

- the snapshot list reads like version history for end users
- the debugging detail still exists when deliberately opened

### 2. Project Identity And Slug Surfaces

Primary targets:

- `packages/frontend/src/components/projects/listing/ProjectCard.tsx`
- `packages/frontend/src/pages/EmbeddedStudio.tsx`
- `packages/frontend/src/pages/ProjectFullscreen.tsx`
- `packages/frontend/src/pages/StudioFullscreen.tsx`

Plan:

- Make `project.title` the primary displayed name wherever a user is browsing or entering a project.
- Treat slug as URL/admin metadata, not the project’s main visible identity.
- Relabel slug consistently as `URL name` or equivalent.
- Move slug rename out of common project actions and into an advanced/admin settings area.
- Keep slug visible where operationally needed, but not as the default project label.

Desired result:

- user-facing project surfaces feel named and intentional rather than system-generated

### 3. Plugin Surfaces And Generic Plugin Host

Primary targets:

- `packages/frontend/src/pages/ProjectPlugins.tsx`
- `packages/frontend/src/plugins/GenericProjectPluginPage.tsx`
- `packages/frontend/src/app/router/routes.tsx`
- `packages/backend/src/trpcRouters/plugins/generic.ts`

Plan:

- Split plugin information into user-facing setup/status versus technical/admin detail.
- Remove raw JSON config editing from the default plugin page.
- Replace raw runtime/instance status copy with friendlier status language in the default view.
- Add a dedicated technical/admin section for raw snippets, debug payloads, and generic JSON config.
- Tighten router permissions so generic technical plugin surfaces are not automatically available to every assigned project member.
- Audit backend procedures so read/update/action permissions match the intended frontend visibility.

Desired result:

- plugin pages feel like product setup pages first
- raw host/plugin debugging tools remain available deliberately and safely

### 4. Maintenance And Operator Tooling

Primary targets:

- `packages/frontend/src/pages/Organization.tsx`
- `packages/frontend/src/components/admin/maintenance/TenantMaintenanceTab.tsx`
- `packages/frontend/src/hooks/usePermissions.ts`
- `packages/backend/src/trpcRouters/project/maintenance.ts`

Plan:

- Align frontend tabs and backend procedures to one permission model.
- Move maintenance out of normal organization admin navigation and into a dedicated operator panel.
- Default that panel to superadmin only in the first pass unless a specific org-admin operation is intentionally carved out.
- Reframe maintenance copy around recovery/repair tasks instead of internal implementation names where possible.

Desired result:

- normal admins do not encounter platform operator tooling in routine organization management

### 5. Publish And Release Language

Primary targets:

- `packages/studio/client/src/components/preview/toolbar/components/QuickActions.tsx`
- `packages/studio/client/src/components/publish/PublishDialog.tsx`

Plan:

- Remove Git wording from primary publish CTAs and tooltips.
- Keep tag/version internals inside technical details only.
- Use one consistent mental model such as `Publish version`, `Release`, or `Saved version`.
- Keep raw tag names available when needed for debugging or support.

Desired result:

- publish reads like product publishing, not source-control operations

## Shared Implementation Shape

### Technical Detail Primitive

Add a shared UI pattern for hidden advanced detail, likely based on the existing preview error panel pattern:

- title such as `Technical details`
- collapsed by default
- optional role gate
- optional server-provided `uiAllowed`

The same primitive should work for version history, plugin pages, publish dialogs, and error states.

### Visibility Contract

Use explicit visibility categories in host surfaces rather than ad-hoc booleans where possible:

- `default`
- `technical`
- `operator`

This does not need to become a large shared framework first, but the meaning should stay consistent across UI and backend responses.

### Copy Strategy

Prefer these translations:

- slug -> URL name
- commit hash / tag -> technical details
- changed files -> change summary
- instance/runtime status -> plugin status / connection status

The exact final labels can be tuned during implementation, but the direction should stay consistent.

## Rollout Sequence

1. Introduce the shared technical-details pattern and use it on one high-signal surface first.
2. Clean up snapshot/version history because it is the clearest end-user mismatch.
3. Switch project browsing and fullscreen headers to title-first naming.
4. Split plugin pages into default vs technical/admin experiences, with matching backend permission hardening.
5. Move maintenance into an operator-only surface and align frontend/backend permissions.
6. Finish by cleaning publish/release copy and any remaining Git-first labels.

## Validation

Frontend:

- component tests for collapsed technical detail behavior
- permission tests for admin/operator surface visibility
- regression tests for title-first project labeling
- plugin page tests for default vs technical/admin rendering

Backend:

- router tests proving restricted technical/admin procedures are not available to ordinary project members
- response-shape tests for gated detail such as `uiAllowed`
- maintenance permission tests aligned with final role policy

Product review:

- quick audit pass on the top navigation, project list, project detail, plugin pages, publish flow, and version history after each slice
- verify that support/debug data is still reachable without reintroducing it into the main path

## Non-Goals

- redesigning the full role model for the whole product
- hiding every technical term everywhere regardless of usefulness
- building a generic permissions framework before fixing the current high-signal surfaces
- changing plugin architecture itself as part of this UX cleanup

## Open Decisions

- Should read-only technical details be available to all project members when deliberately opened, or restricted to org admins and superadmins?
- Which maintenance actions, if any, should remain available to org admins instead of moving fully behind superadmin?
- Should raw generic plugin JSON config remain available anywhere outside a dedicated admin/debug page?
- Should the technical-details open/closed state persist per user, or remain session-local?
- What should the default end-user label be for publish snapshots: `Version`, `Published version`, `Release`, or another term?
