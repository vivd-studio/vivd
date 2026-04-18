---
name: vivd-plugins
description: Use when adding, extracting, wiring, or debugging Vivd plugins across backend, frontend, CLI, Studio, Docker, or agent surfaces. Covers the current plugin architecture, where plugin-owned code belongs, how host registries and compatibility wrappers work, and the common workspace-package pitfalls to check before shipping.
---

# Vivd Plugins

Use this skill when the task involves a Vivd plugin or the plugin platform itself.

This skill is for:
- adding a new first-party plugin
- changing an existing plugin such as Analytics or Contact Form
- extracting plugin code into its own workspace package
- wiring plugin UI/routes/CLI/help/actions
- debugging why a plugin works in typecheck but fails in Docker, Vite, or runtime

## Current Shape

Vivd is in a mixed state:
- plugin-owned workspaces now live under `plugins/`
- curated external/embed providers can now live under `plugins/external/*`
- first-party native plugins currently live under `plugins/native/*`
- host apps still own the generic plugin platform, registries, routing, and compatibility layers
- the actual plugin implementation/runtime code for Analytics and Contact Form now lives in the plugin packages; host code should mostly be adapters
- plugin packages now expose manifests and surface-specific packages directly; the installed bundle in `plugins/installed` composes those manifests plus per-surface imports from one registry config instead of relying on per-plugin descriptor wrappers
- the installed bundle order now lives in `plugins/installed/registry.config.mjs`; `plugins/installed/src/index.ts` and the generated surface files should be regenerated from that registry instead of edited by hand
- config-time helpers for registry-driven plugin package matchers and source aliases now live in `plugins/installed/registry.helpers.mjs`, and root plugin-workspace fanout scripts should prefer that helper over repeating plugin package names by hand
- backend host binding for native plugins now prefers `backend.createHostContribution(hostContext)` exposed by the plugin package; `packages/backend/src/services/plugins/descriptors.ts` builds those contributions directly from `plugins/installed`, so new per-plugin `hostPlugin.ts` or `hostRegistry.ts` files in backend are the wrong direction
- backend host context should expose generic services only; plugin-owned email builders now live in plugin packages and receive generic delivery/branding helpers from host context instead of a host-owned `email.templates` bag
- plugin-owned frontend code should import shared primitives from `@vivd/ui`; `packages/frontend/src/plugins/host.ts` is for host runtime helpers such as `trpc`, routes, and project-page scaffolding, not generic buttons/inputs/cards
- `external_embed` plugins are still host-managed at runtime: they do not need native backend/frontend/CLI module exports, and backend should synthesize generic info/config/snippet behavior from the manifest instead of forcing a fake `PluginModule`

Treat the architecture as:
- shared contract layer in `packages/shared`
- plugin SDK in `plugins/sdk`
- installed plugin registry in `plugins/installed`
- backend host/plugin registry in `packages/backend`
- frontend host/plugin registry in `packages/frontend`
- CLI host/plugin registry in `packages/cli`
- plugin-owned implementation in plugin packages when extracted

Do not assume every plugin is fully package-owned yet.

## File Map

Start here when orienting:

- Shared UI and CLI-facing types:
  - `packages/shared/src/types/plugins.ts`
  - `packages/shared/src/types/pluginCli.ts`
  - `packages/shared/src/types/pluginContracts.ts`
  - `packages/shared/src/types/pluginPackages.ts`
- Installed plugin set:
  - `plugins/installed/registry.config.mjs`
  - `plugins/installed/registry.helpers.mjs`
  - `plugins/installed/src/index.ts` (generated)
  - `plugins/installed/src/backend.ts`
  - `plugins/installed/src/frontend.ts`
  - `plugins/installed/src/cli.ts`
  - `plugins/installed/src/studio.ts`
- Backend plugin host:
  - `packages/backend/src/services/plugins/descriptors.ts`
  - `packages/backend/src/services/plugins/registry.ts`
  - `packages/backend/src/services/plugins/integrationHooks.ts`
  - `packages/backend/src/services/plugins/core/module.ts`
  - `packages/backend/src/services/plugins/ProjectPluginService.ts`
  - `packages/backend/src/trpcRouters/plugins/index.ts`
  - `packages/backend/src/trpcRouters/plugins/generic.ts`
- Frontend plugin host:
  - `packages/frontend/src/plugins/registry.tsx`
  - `packages/frontend/src/plugins/types.ts`
  - `packages/frontend/src/pages/ProjectPlugins.tsx`
  - `packages/frontend/src/pages/ProjectPluginPage.tsx`
- CLI host:
  - `packages/cli/src/commands.ts`
  - `packages/cli/src/plugins/registry.ts`
- Extracted plugin package example:
  - `plugins/external/google-maps/package.json`
  - `plugins/external/google-maps/src/manifest.ts`
  - `plugins/external/google-maps/src/manifest.ts`
  - `plugins/native/analytics/package.json`
  - `plugins/native/analytics/src/manifest.ts`
  - `plugins/native/analytics/src/backend/config.ts`
  - `plugins/native/analytics/src/backend/module.ts`
  - `plugins/native/analytics/src/frontend/module.ts`
  - `plugins/native/analytics/src/frontend/AnalyticsProjectPage.tsx`
  - `plugins/native/analytics/src/cli/module.ts`
  - `plugins/native/analytics/src/shared/projectUi.ts`
  - `plugins/native/contact-form/package.json`
  - `plugins/native/contact-form/src/manifest.ts`
  - `plugins/native/contact-form/src/backendHooks.ts`
  - `plugins/native/contact-form/src/backend/config.ts`
  - `plugins/native/contact-form/src/backend/module.ts`
  - `plugins/native/contact-form/src/backend/adminHooks.ts`
  - `plugins/native/contact-form/src/frontend/module.ts`
  - `plugins/native/contact-form/src/frontend/ContactFormProjectPage.tsx`
  - `plugins/native/contact-form/src/cli/module.ts`
  - `plugins/native/contact-form/src/shared/projectUi.ts`
  - Backend-owned compatibility adapters now live in `packages/backend/src/trpcRouters/plugins/contactForm.ts` and `packages/backend/src/trpcRouters/plugins/analytics.ts`
  - Public plugin HTTP route composition now lives in `packages/backend/src/httpRoutes/plugins/registry.ts`

## Decision Rule

Before editing, decide whether the change is:

1. Host/platform work
   - shared contracts
   - generic registry behavior
   - generic plugin list UI
   - generic CLI grammar
   - auth/router composition
   - Docker/workspace/package plumbing

2. Plugin-owned work
   - plugin manifest/definition
   - plugin-specific backend handlers
   - plugin-specific public router extensions
   - plugin page or panel UI
   - plugin-specific CLI formatting/help/aliases
   - plugin-specific instructions, snippets, usage, actions

Keep plugin-specific behavior out of host code unless it is a temporary compatibility wrapper.

## Preferred Direction

Aim for this boundary:

- host apps keep the generic surface
- plugin packages own their own behavior
- the CLI grammar stays generic: `vivd plugins ...`
- plugin packages contribute manifests/renderers/help instead of inventing new top-level command trees
- frontend routes are mounted by the host, but plugin pages/panels are owned by the plugin

Good examples:
- generic catalog, info, config, and action transport in the host
- plugin-specific dashboard page in the plugin package
- shared shortcut metadata in `packages/shared/src/types/plugins.ts`
- richer control-plane mutations still going through the generic `plugins.action` surface by sending structured `input` payloads instead of reviving plugin-specific backend routers
- plugin-owned public route aliases declared as extra `publicRoutes` entries in the plugin contribution when the same router must mount at more than one host path

Bad examples:
- adding another hardcoded plugin list to a frontend page
- duplicating plugin metadata in backend, frontend, and CLI separately
- making the CLI parser plugin-specific when a generic subcommand already exists

## Add Or Change A Plugin

Use this sequence:

1. Define or update the plugin definition.
   - Keep the plugin definition in the plugin package
   - Export a safe package manifest from the plugin package
   - Put short plugin-specific agent guidance in `definition.agentHints` when the agent needs durable rules that should follow the plugin everywhere
   - Register the plugin through the installed-plugin registry and host contribution lists instead of adding separate hardcoded arrays/maps per surface

2. Wire the backend module.
   - Implement `PluginModule` behavior using shared contracts from `packages/shared`
   - Support generic info/config/action flows when possible
   - Prefer a plugin-owned `backend.createHostContribution(hostContext)` that binds host runtime/services into the plugin package; do not add a new backend-side per-plugin `hostPlugin.ts`
   - Keep plugin-specific router payloads thin, but keep compatibility tRPC routers as temporary backend host adapters rather than making extracted plugin packages import `@vivd/backend/src/...`
   - If organization overview, super-admin/plugin-entitlement flows, background jobs, or plugin-owned project-maintenance work need plugin-specific behavior, put that behavior in plugin-owned backend hooks and register it through `packages/backend/src/services/plugins/integrationHooks.ts`

3. Wire shared UI metadata.
   - Keep the shared UI types/helpers in `packages/shared/src/types/plugins.ts`
   - Put plugin-owned UI metadata in the plugin package when possible
   - Register that metadata in the frontend and Studio shared UI registries

4. Wire frontend ownership.
   - Register the frontend module in `packages/frontend/src/plugins/registry.tsx`
   - Use a generic fallback page unless the plugin needs custom UI
   - Put custom pages in the plugin package if the plugin is extracted
   - Import shared buttons/cards/inputs/selects/tabs and similar primitives from `@vivd/ui`, not from `packages/frontend/src/...`
   - Keep `packages/frontend/src/plugins/host.ts` limited to host-only capabilities such as `trpc`, route helpers, and project-page scaffolding
   - Delete dead host-side re-export wrappers once callers import the plugin package directly; do not leave `packages/frontend/src/plugins/<plugin>/module.ts` around as inert compatibility clutter
   - Keep plugin-specific frontend tests beside the plugin package UI where practical; let the frontend workspace Vitest config include them rather than storing plugin-only test files under `packages/frontend/src/plugins`

5. Wire CLI ownership.
   - Keep the generic CLI grammar in `packages/cli/src/commands.ts`
   - Register plugin-owned help/aliases/formatters in `packages/cli/src/plugins/registry.ts`

6. Check package boundaries.
   - If a host package imports `@vivd/plugin-...`, add it to that host’s `package.json`
   - If a plugin package imports `@vivd/ui`, add that dependency to the plugin package and refresh the root `package-lock.json`
   - If a plugin package imports a plugin-sdk subpath such as `@vivd/plugin-sdk/emailTemplates`, make sure its `tsconfig.json` includes the `@vivd/plugin-sdk/*` source alias
   - Update Dockerfiles and compose/dev sync rules so the workspace package exists inside containers

## Frontend Panels

Plugins may have:
- no custom panel, using the generic fallback page
- one custom project page
- richer custom pages and direct shortcuts such as Analytics

When adding richer UI:
- prefer plugin-owned pages/components over app-owned special cases
- keep route mounting generic in the host
- put shortcut/icon/open-label metadata in plugin-owned shared UI exports
- avoid baking plugin IDs directly into unrelated host components

## Docker And Workspace Pitfalls

This is the most common failure mode.

If a host workspace imports a plugin workspace package, you usually need all of these:
- the plugin added to the host `package.json`
- root `package-lock.json` refreshed
- plugin `package.json` copied into the relevant Docker deps/install stage
- plugin workspace included in `npm ci -w ...`
- plugin source copied into dev/build stages when bundling or Vite needs it
- compose `develop.watch` sync/rebuild rules updated when local Docker dev should see plugin changes

Symptom patterns:
- backend container boots locally, but Docker prod/dev crashes with `ERR_MODULE_NOT_FOUND`
- Vite says it cannot resolve `@vivd/plugin-.../...`
- typecheck passes because of TS path aliases, but runtime resolution fails

When you see that mismatch, inspect `package.json`, Dockerfiles, and compose watch rules before chasing app logic.

## Snippet UX

For public-facing plugin snippets:
- prefer progressive enhancement over raw full-page form posts when inline success/error is practical
- default to a small `fetch` submit path with inline status feedback for generated snippets
- keep the non-JS fallback acceptable: if the browser leaves the page, land on a clear success/error page rather than a blank or low-context response
- make sure snippet success handling matches local preview/runtime URL reality, not just the published-site happy path

## Validation

Pick the smallest useful set:

- Typecheck touched workspaces:
  - `npm run typecheck -w @vivd/plugin-analytics`
  - `npm run typecheck -w @vivd/plugin-contact-form`
  - `npm run typecheck -w @vivd/frontend`
  - `npm run typecheck -w @vivd/backend`
  - `npm run typecheck -w @vivd/cli`
- If Docker wiring changed, build the affected image:
  - `docker compose build frontend`
  - `docker compose build backend`
  - `npm run build:studio:local`
- Run focused tests for touched registries/pages/routers

Prefer targeted validation over full-suite runs.

If you are extracting a plugin into its own package, also read:
- `references/extraction-checklist.md`

## Compatibility Wrappers

Some legacy paths still exist. Keep them thin.

Examples:
- plugin-specific backend router files under `packages/backend/src/trpcRouters/plugins/*`
- backend plugin integration registries such as `packages/backend/src/services/plugins/integrationHooks.ts`
- compatibility page re-exports such as `packages/frontend/src/pages/ProjectAnalytics.tsx`
- old backend plugin re-export folders under `packages/backend/src/services/plugins/<plugin>/` and `packages/backend/src/httpRoutes/plugins/<plugin>/`

If you touch a compatibility layer:
- move logic into the plugin or generic host layer first
- leave the old path as a thin adapter or re-export only if still needed
- if nothing in-repo still imports it after the move, delete it instead of preserving a dead wrapper

## Project-State Note

When plugin architecture or plugin surface behavior changes, update the project-state file used by the current branch. In this repo state, `PROJECT_STATE.md` is the active file. Keep entries short and factual.
