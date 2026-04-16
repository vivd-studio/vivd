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
- approval popups and chat activity still surface raw CLI commands and labels such as `Ran bash`
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

### 4. Agent Chat And Approval Language

Primary targets:

- `packages/studio/client/src/features/opencodeChat/permissions/PermissionDock.tsx`
- `packages/studio/client/src/components/chat/chatStreamUtils.ts`
- `packages/studio/client/src/components/chat/message-list/AgentMessageRow.tsx`
- `packages/studio/server/trpcRouters/agentChat.ts`
- `packages/studio/server/opencode/index.ts`

Plan:

- Replace raw permission labels and command-first approval text with intent-first copy such as `Publish the site`, `Run a project check`, or `Apply a repair step`.
- Keep raw command patterns available only inside a technical-details disclosure in the approval UI.
- Replace timeline labels such as `Running bash...` and `Ran bash` with end-user-readable action labels derived from intent, not shell implementation.
- When the system cannot confidently classify the action, fall back to neutral product wording such as `Running a technical task` instead of exposing `bash`.
- Extend the permission/tool metadata contract so the server can provide human-facing titles, summaries, and technical fallbacks explicitly instead of forcing the UI to infer them from raw command strings.

Implementation direction:

- Do not hardcode translation strings separately in `PermissionDock`, `chatStreamUtils`, and `AgentMessageRow`.
- Add one central action-label resolver for the Studio chat surface, likely under `packages/studio/client/src/features/opencodeChat/`.
- Back that resolver with a dictionary of known action intents keyed by:
  - permission type such as `bash`
  - tool type such as `bash`, `read`, `edit`, `write`
  - recognized `vivd` command shapes such as publish, unpublish, checklist, support, and plugin actions
- Make the dictionary argument-aware for a small allowlisted set of user-meaningful flags such as `--domain`, target environment, and plugin identifiers.
- Have the dictionary return a normalized UI model such as:
  - `displayTitle`
  - `displaySummary`
  - `runningLabel`
  - `completedLabel`
  - `errorLabel`
  - `technicalCommand`
  - `showTechnicalDetails`
- Keep the UI components thin: they should consume resolved labels, not parse commands themselves.
- Preserve raw arguments in `technicalCommand`, but lift safe meaningful values into the display copy when they help the user understand the action.
- Add optional server metadata fields only as an enhancement path for actions that cannot be classified cleanly on the client.

Suggested first files:

- new dictionary/resolver module: `packages/studio/client/src/features/opencodeChat/actionLabels.ts`
- optional shared types helper if the shape needs reuse: `packages/studio/client/src/features/opencodeChat/types.ts`
- consuming adapters:
  - `packages/studio/client/src/features/opencodeChat/permissions/PermissionDock.tsx`
  - `packages/studio/client/src/components/chat/chatStreamUtils.ts`
  - `packages/studio/client/src/components/chat/message-list/AgentMessageRow.tsx`

Desired result:

- approval requests explain what Vivd wants to do, not which shell command it plans to run
- chat activity feels like product actions instead of a terminal transcript

### 5. Maintenance And Operator Tooling

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

### 6. Publish And Release Language

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

### Command Translation Contract

Approval requests and chat tool rows should not rely on raw shell commands as their primary UI text.

Recommended direction:

- use one central dictionary/resolver as the first source of truth for end-user action wording
- classify known `vivd` actions centrally so publish/checklist/support/plugin flows map to one consistent set of labels
- support templated labels that can incorporate safe extracted arguments, for example `Deploy to example.com` from `vivd publish deploy --domain example.com`
- keep raw command text in a separate technical field
- add optional human-facing fields such as `displayTitle` and `displaySummary` to permission/tool metadata only where client-side classification is not sufficient
- let the UI render human-facing labels first and only expose the raw command when someone deliberately opens technical details

Recommended phases:

1. Client dictionary phase

- introduce the centralized dictionary/resolver
- translate current `bash` permission and chat activity labels using recognized command patterns plus allowlisted argument extraction
- preserve raw commands only inside technical details

2. Metadata phase

- extend permission/tool metadata with optional display fields where the client cannot infer intent safely
- keep the same dictionary as the fallback for backward compatibility

3. Cleanup phase

- remove duplicated command-label logic from individual components
- align tests and snapshots around the normalized label model

Out of scope for the first slice:

- full natural-language translation of arbitrary shell commands
- trying to prettify every unknown command beyond a safe generic fallback
- moving the whole classification engine to the backend before the client dictionary proves out

### Copy Strategy

Prefer these translations:

- slug -> URL name
- commit hash / tag -> technical details
- changed files -> change summary
- instance/runtime status -> plugin status / connection status
- `bash` / raw shell command -> action summary

The exact final labels can be tuned during implementation, but the direction should stay consistent.

## Rollout Sequence

1. Introduce the shared technical-details pattern and use it on one high-signal surface first.
2. Clean up snapshot/version history because it is the clearest end-user mismatch.
3. Switch project browsing and fullscreen headers to title-first naming.
4. Translate approval popups and chat activity to intent-first action language, with raw commands moved behind technical details.
5. Split plugin pages into default vs technical/admin experiences, with matching backend permission hardening.
6. Move maintenance into an operator-only surface and align frontend/backend permissions.
7. Finish by cleaning publish/release copy and any remaining Git-first labels.

## Validation

Frontend:

- component tests for collapsed technical detail behavior
- permission tests for admin/operator surface visibility
- regression tests for title-first project labeling
- approval-dock and chat-timeline tests for human-facing action labels
- unit tests for the centralized action-label dictionary, including fallback behavior for unknown commands
- plugin page tests for default vs technical/admin rendering

Backend:

- router tests proving restricted technical/admin procedures are not available to ordinary project members
- response-shape tests for gated detail such as `uiAllowed`
- permission/tool metadata tests for human-facing labels plus raw technical fallback
- maintenance permission tests aligned with final role policy

Specific agent-chat signoff for the first slice:

- `vivd publish deploy ...` no longer shows raw CLI text by default in the approval popup
- `vivd publish deploy --domain example.com` can render a user-facing label such as `Deploy to example.com`
- `bash` tool rows no longer render `Running bash...` / `Ran bash`
- unknown commands still render a safe generic label and preserve the raw command behind technical details

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
- Should raw approval commands ever be shown by default to non-admin users, or only inside technical details?
- What should the default end-user label be for publish snapshots: `Version`, `Published version`, `Release`, or another term?
