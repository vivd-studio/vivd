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
- `analytics` and `contact_form` are extracted plugin workspace packages at `packages/plugin-analytics` and `packages/plugin-contact-form`
- host apps still own the generic plugin platform, registries, routing, and compatibility layers
- the actual plugin implementation/runtime code for Analytics and Contact Form now lives in the plugin packages; host code should mostly be adapters

Treat the architecture as:
- shared contract layer in `packages/shared`
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
- Backend plugin host:
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
  - `packages/plugin-analytics/package.json`
  - `packages/plugin-analytics/src/backend/config.ts`
  - `packages/plugin-analytics/src/backend/module.ts`
  - `packages/plugin-analytics/src/frontend/module.ts`
  - `packages/plugin-analytics/src/frontend/AnalyticsProjectPage.tsx`
  - `packages/plugin-analytics/src/cli/module.ts`
  - `packages/plugin-analytics/src/shared/projectUi.ts`
  - `packages/plugin-contact-form/package.json`
  - `packages/plugin-contact-form/src/backend/config.ts`
  - `packages/plugin-contact-form/src/backend/module.ts`
  - `packages/plugin-contact-form/src/backend/adminHooks.ts`
  - `packages/plugin-contact-form/src/frontend/module.ts`
  - `packages/plugin-contact-form/src/frontend/ContactFormProjectPage.tsx`
  - `packages/plugin-contact-form/src/cli/module.ts`
  - `packages/plugin-contact-form/src/shared/projectUi.ts`
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
- plugin packages contribute descriptors/renderers/help instead of inventing new top-level command trees
- frontend routes are mounted by the host, but plugin pages/panels are owned by the plugin

Good examples:
- generic catalog, info, config, and action transport in the host
- plugin-specific dashboard page in the plugin package
- shared shortcut metadata in `packages/shared/src/types/plugins.ts`

Bad examples:
- adding another hardcoded plugin list to a frontend page
- duplicating plugin metadata in backend, frontend, and CLI separately
- making the CLI parser plugin-specific when a generic subcommand already exists

## Add Or Change A Plugin

Use this sequence:

1. Define or update the plugin definition.
   - Register it in `packages/backend/src/services/plugins/registry.ts`
   - Keep manifest-like metadata in one place

2. Wire the backend module.
   - Implement `PluginModule` behavior using shared contracts from `packages/shared`
   - Support generic info/config/action flows when possible
   - Prefer a host adapter that binds backend runtime/services into a plugin-owned module factory
   - Keep plugin-specific router payloads thin, but keep compatibility tRPC routers in backend host adapters rather than making extracted plugin packages import `@vivd/backend/src/...`
   - If organization overview or super-admin/plugin-entitlement flows need plugin-specific behavior, put that behavior in plugin-owned backend hooks and register it through `packages/backend/src/services/plugins/integrationHooks.ts`

3. Wire shared UI metadata.
   - Keep the shared UI types/helpers in `packages/shared/src/types/plugins.ts`
   - Put plugin-owned UI metadata in the plugin package when possible
   - Register that metadata in the frontend and Studio shared UI registries

4. Wire frontend ownership.
   - Register the frontend module in `packages/frontend/src/plugins/registry.tsx`
   - Use a generic fallback page unless the plugin needs custom UI
   - Put custom pages in the plugin package if the plugin is extracted

5. Wire CLI ownership.
   - Keep the generic CLI grammar in `packages/cli/src/commands.ts`
   - Register plugin-owned help/aliases/formatters in `packages/cli/src/plugins/registry.ts`

6. Check package boundaries.
   - If a host package imports `@vivd/plugin-...`, add it to that host’s `package.json`
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

If you touch a compatibility layer:
- move logic into the plugin or generic host layer first
- leave the old path as a thin adapter or re-export only if still needed

## Project-State Note

When plugin architecture or plugin surface behavior changes, update the project-state file used by the current branch. In this repo state, `PROJECT_STATE.md` is the active file. Keep entries short and factual.
