# Project Import, Duplicate, and Build Safety Plan

Date: 2026-04-28
Owner: product/platform
Status: in progress

## Why This Exists

The ATCO production import exposed three separate issues that should not be treated as one ZIP-upload bug:

- ZIP import was being used as a project/version copy workflow.
- Arbitrary uploaded source can contain stale runtime artifacts and platform-specific lockfile state.
- Preview artifact builds can currently run in the control-plane backend request path, which can make unrelated tenants appear stuck while a heavy install/build is running. The dedicated builder path is tracked in `plans/async-preview-builder-plan.md`.

The right correction is to replace the user workflow with first-class duplicate/copy actions, restrict arbitrary ZIP import, and move install/build behavior onto isolated, consistent runtime paths.

## Progress

- 2026-04-28: Completed the first containment slice: arbitrary ZIP import is superadmin-only, public ZIP import entry points are hidden, Astro imports re-upload source after backend build/dependency repair, and backend/Studio can repair Rollup optional-native and esbuild native-binary npm failures by reinstalling without the stale npm lockfile. Remaining work is the product duplicate/copy workflow plus the separate async builder path in `plans/async-preview-builder-plan.md`.
- 2026-04-28: Added the first build-free duplicate workflow: backend project copy service, version-level artifact prefix copy, project duplicate tRPC mutation, and project-card duplicate dialog. Copy-version internals remain parked, but the public API/UI exposure is disabled for now so the only normal product action is "duplicate selected version as a new project." The workflow copies completed versions only, adds an optimistic "Duplicating" project card immediately, and reuses existing source/preview artifacts instead of running a backend build.

## Incident Summary

Observed behavior:

- A large ATCO ZIP import created a project and preview artifact.
- The control-plane preview artifact built successfully after retrying dependency install.
- Studio later failed because its hydrated source artifact still had the original uploaded `package-lock.json`, which referenced macOS Rollup optional dependency state but not `@rollup/rollup-linux-x64-gnu`.
- Other tenants appeared unavailable for about a minute while the backend was inside synchronous dependency install/build work.

Root causes:

- Source artifact upload happened before dependency/lockfile repair.
- Backend and Studio used different install/recovery behavior.
- The backend API process used blocking build work for import preview generation.
- Public ZIP import is too broad for the actual product need.

## Product Decision

### Keep ZIP Import Internal

Arbitrary ZIP import should become superadmin-only. It remains useful for migration, support, and emergency recovery, but it should not be a normal hosted-user workflow.

Public ZIP import can come back later only as a constrained Vivd export re-import:

- require a `.vivd/export.json` manifest,
- reject arbitrary repo ZIPs,
- strip runtime/build artifacts,
- validate size, file count, paths, symlinks, and manifest version,
- build preview asynchronously.

### Build A Real Copy Workflow

Users who download a ZIP and re-upload it are usually trying to:

- duplicate a project,
- fork a project into a new project,
- create a new version from an existing version,
- preserve an existing design before making risky edits.

Those should be product actions, not file-transfer workarounds.

## Goals

- Provide safe project duplication and version-copy workflows for normal users.
- Prevent arbitrary uploads from blocking or destabilizing the hosted control plane.
- Keep Studio source artifacts, preview artifacts, local project directories, and dependency lockfiles consistent.
- Share dependency install/repair behavior across backend/build worker and Studio.
- Preserve the ability to recover/migrate projects through superadmin ZIP import.
- Improve import/copy/build status visibility so users know when source, preview, and Studio runtime readiness differ.

## Non-Goals

- Do not build full public Git import in the first slice.
- Do not make arbitrary ZIP import public again until the Vivd export manifest path exists.
- Do not require every copied project to have a successful preview build before source can be opened in Studio.
- Do not redesign the whole preview architecture here; keep that work in `plans/studio-preview-architecture-plan.md`.

## Phase 0: Production Cleanup And Containment

### Current ATCO Repair

- Repair the existing ATCO `source/` artifact so it no longer contains the stale uploaded lockfile.
- Restart or hard-reset the ATCO Studio machine so it hydrates the repaired source.
- Confirm Studio clean preview starts after hydration.

### Immediate ZIP Restrictions

- Backend `/api/import` should require superadmin access for arbitrary ZIP upload.
- Frontend should hide Import ZIP for normal org users.
- Keep size checks and runtime artifact stripping as defense in depth.
- Add a visible internal label/copy for superadmins so the action is understood as migration tooling.

### Immediate Regression Fixes

- If backend import/build mutates dependency files, re-upload source after mutation before marking the import complete.
- Studio clean reinstall should support deleting `package-lock.json` when the known npm/Rollup optional dependency failure is detected.
- Studio dev server should retry the Rollup native optional-dependency failure with the same repair strategy as the backend/build worker.

## Phase 1: First-Class Duplicate Project

### Backend Copy Service

Add a service, for example `ProjectCopyService`, that copies one completed source version into a new project:

- a new project: `duplicateProject`

Keep same-project version copy as parked internal/future work until the duplicate workflow is clear and reliable.

Inputs:

- `organizationId`
- source `slug`
- source `version`
- destination title/slug

Behavior:

- resolve source from the freshest safe source:
  - if a Studio machine is running and has unsynced source, either trigger a sync first or block with clear UI copy,
  - otherwise use local version dir if present,
  - otherwise hydrate from object storage `source/`.
- copy into the target version directory.
- strip runtime/build artifacts:
  - `node_modules`,
  - `dist`,
  - `.astro`,
  - `.vite`,
  - `.cache`,
  - package-manager caches,
  - transient `.git/index.lock`.
- remove imported/export-only metadata that should not become project source.
- initialize or repair git state and create a clean commit.
- create the target project/version DB row.
- upload source artifact.
- copy existing preview/thumbnail artifacts when available.
- later enqueue preview build and thumbnail work through `plans/async-preview-builder-plan.md` if a fresh build is needed.

### tRPC Procedures

Add:

- `project.duplicateProject({ sourceSlug, sourceVersion, title, slug, copyPlugins? })`

Permission model:

- source project access required,
- destination project creation/version creation permissions required,
- no superadmin requirement.

### Plugin Copy Policy

For new-project duplication:

- default to copying enabled plugin instances and basic plugin config,
- do not copy tenant/customer data that should stay with the original project unless the plugin explicitly marks it copyable,
- record a clear follow-up for plugin-owned data-copy contracts.

For same-project version copy later, project-level plugin enablement remains shared by the project and version source is copied only.

### Frontend UX

Add actions:

- Project card actions menu: `Duplicate project`
- Studio/project header where appropriate: `Duplicate project`

Dialogs:

- duplicate project dialog: title and slug fields, source version selector if needed,
- no copy-version dialog in V1.

Statuses:

- `duplicating_project`
- `building_preview`
- `completed`
- `failed`

The UI should communicate that source may be ready before preview thumbnail/publish-preview is ready.

## Phase 2: Async Preview Build Isolation

Move preview artifact builds out of backend API request handlers through the dedicated builder plan in `plans/async-preview-builder-plan.md`.

This plan keeps the product/import/copy decisions here, and the builder plan owns the operational details: build-job service, one-shot Docker/Fly providers, status model, stale-job behavior, and production-shaped validation.

Status model requirement for this plan: source readiness and preview readiness must stay separate, and a failed preview artifact build must not block Studio source access.

## Phase 3: Shared Dependency Install And Repair

### Problem

Backend import/build, builder, and Studio dev server currently have overlapping but inconsistent dependency install logic.

This causes drift:

- backend may repair a lockfile/source state,
- source artifact may preserve stale uploaded state,
- Studio may use `npm ci` against stale lockfiles,
- clean reinstall may remove only `node_modules`.

### Target

Create a shared Node-only dependency install/repair helper used by:

- `packages/builder`,
- Studio `DevServerService`,
- any remaining backend build path while it exists.

Candidate locations:

- extend `@vivd/builder` with reusable dependency helpers if Studio can consume it cleanly, or
- create a small Node-only workspace package for install/repair logic.

Do not put Node filesystem/process helpers into browser-facing shared packages.

### Repair Strategy

Generic rules:

- never trust uploaded/copied `node_modules`,
- prefer normal install first,
- run sanity checks for native/toolchain packages,
- repair only known, explainable failure classes,
- avoid deleting lockfiles blindly for pnpm/yarn,
- persist source artifact only after any source/lockfile mutation.

Known repair classes:

- Rollup native optional dependency missing:
  - npm: remove `node_modules` and `package-lock.json`, run `npm install --include=optional --no-audit --no-fund`,
  - verify `@rollup/rollup-linux-*` can be required.
- esbuild host/binary mismatch:
  - remove `node_modules`, reinstall,
  - keep current existing Studio check.
- sharp/libvips native mismatch:
  - add detection and reinstall strategy if this appears in production.
- lightningcss native mismatch:
  - add detection and reinstall strategy if this appears in production.

### Studio Clean Reinstall

The user-facing clean reinstall action should:

- remove runtime caches,
- remove `node_modules`,
- optionally remove npm lockfile only when the known npm optional-native failure has occurred or when the user chooses a deeper repair action,
- use the same install command policy as the shared helper,
- report a clear status in the preview error panel.

## Phase 4: Safer Export/Re-Import Later

If Vivd export re-import becomes a public feature:

- exported ZIPs must include `.vivd/export.json`,
- import accepts only recognized export manifests,
- import validates exported Vivd version and schema version,
- import strips runtime/build artifacts,
- import handles project metadata through DB-only paths,
- import creates a project/version quickly and builds preview asynchronously.

Arbitrary website/repo ZIP upload remains superadmin-only.

## Phase 5: Git Import Future

Git import is a better public external-project path than arbitrary ZIP upload, but it is a separate product feature.

Before public Git import:

- clone to isolated temp workspace,
- pin commit SHA,
- enforce repo size, file count, path, and symlink limits,
- reject `node_modules` and large generated artifacts,
- preflight framework/package manager,
- install/build in builder isolation,
- create project only after preflight passes or create a clear failed preflight state.

This should not block the duplicate/version-copy replacement.

## Data And API Changes

Expected backend additions:

- copy service for source-to-source project/version duplication,
- new tRPC mutations for duplicate/copy version,
- artifact build enqueue/start procedure from `plans/async-preview-builder-plan.md`,
- source-artifact freshness helpers,
- dependency repair helper shared with Studio/builder.

Expected status additions:

- `copying_project`
- `copying_version`
- `building_preview`

Expected artifact metadata additions:

- build request id or commit hash,
- started/completed timestamps,
- error summary,
- optional log key if full logs are stored.

## UI Changes

Control-plane frontend:

- hide ZIP import unless superadmin,
- add duplicate project action,
- show clearer preview-build status separate from project source status,
- show failed preview build without implying source import/copy failed.

Studio:

- align clean reinstall with shared repair behavior,
- improve technical error panel copy for dependency repair,
- keep `Ask agent to fix it` for project-code errors but avoid making dependency-environment failures look like authoring mistakes.

## Operational Guardrails

- No synchronous install/build in the backend API request path; see `plans/async-preview-builder-plan.md`.
- No uploaded/copied `node_modules` in stored source artifacts.
- No source artifact marked ready if known source/lockfile repair is still pending.
- Builder jobs must be bounded by timeout, CPU, memory, and concurrency.
- Preview build failure must not delete copied source.
- Studio source hydration should always prefer canonical `source/` artifact for a version, not a stale local build output.

## Implementation Order

1. Restrict arbitrary ZIP import to superadmins and hide the public UI.
2. Fix source artifact consistency for the existing import path.
3. Add Studio dependency repair parity for Rollup optional-native failures.
4. Add duplicate project backend service and public mutation.
5. Add duplicate-project UI with optimistic loading card.
6. Move import/copy preview builds to the async builder flow in `plans/async-preview-builder-plan.md`.
7. Extract shared dependency install/repair helper.
8. Add manifest-based Vivd export re-import only if still needed.
9. Consider same-project copy-version workflow only after duplicate project is reliable.
10. Design Git import as a separate external-project import feature.

## Validation Plan

Use targeted checks first.

Backend:

- copy service tests for new project duplication,
- import route tests for superadmin-only ZIP import,
- source artifact tests proving repaired lockfiles are uploaded,
- builder enqueue/status tests,
- `npm run typecheck -w @vivd/backend`.

Studio:

- `DevServerService` tests for Rollup optional dependency retry,
- clean reinstall tests for cache/node_modules/lockfile behavior,
- `npm run test:run -w @vivd/studio -- server/httpRoutes/runtime.test.ts server/services/project/DevServerService.test.ts` or nearest existing file names,
- `npm run typecheck -w @vivd/studio`.

Builder:

- dependency repair tests around npm lockfile/native optional failure,
- artifact build tests for stale commit/build meta,
- `npm run typecheck -w @vivd/builder`.

Frontend:

- import button visibility by role,
- duplicate project dialog behavior,
- optimistic duplicate project card behavior,
- status presentation tests,
- `npm run typecheck -w @vivd/frontend`.

Production-shaped:

- duplicate ATCO into a new project and open Studio,
- confirm preview artifact builds asynchronously,
- confirm other tenants load while the build is running,
- run relevant Studio/Fly lifecycle smoke if builder or Studio machine startup changes.

## Open Questions

- Should duplicate-project copy plugin enablement by default, and which plugin data is safe to copy?
- Should copy-version come back later, and if so should it be available to all project editors or only org admins/project admins?
- Do we want one generic `processing` project version status plus artifact meta, or explicit statuses such as `duplicating_project`?
- Should Vivd export ZIPs be signed or just manifest-validated?
- Should public Git import create a failed/preflight project row, or reject before project creation?
