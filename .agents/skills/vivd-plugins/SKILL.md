---
name: vivd-plugins
description: Use when adding, extracting, wiring, or debugging Vivd plugins across backend, frontend, CLI, Studio, Docker, or agent surfaces. Covers the current plugin architecture, where plugin-owned code belongs, how host registries and compatibility wrappers work, and the common workspace-package pitfalls to check before shipping.
---

# Vivd Plugins

Use this skill when the task involves a Vivd plugin or the plugin platform itself.

This skill is for:

- adding or changing a plugin package
- extracting plugin code out of a host workspace
- wiring plugin UI, routes, CLI help, actions, or public snippets
- debugging why a plugin typechecks locally but fails in Docker, Vite, or runtime

## Quick Workflow

1. Classify the change:
   - host or platform work
   - plugin-owned feature work
   - workspace or Docker plumbing
2. Start from the current registry and one real plugin example. Do not infer the architecture from old wrappers.
3. Keep host code generic and thin. Move plugin-specific behavior into the plugin package unless a temporary compatibility layer is still required.
4. If a host imports a plugin package, wire `package.json`, the root lockfile, Docker install stages, and local dev sync together.
5. Validate the touched plugin plus the touched host workspaces; do not default to full-suite runs.

## Durable Boundaries

- Shared contracts live in:
  - `packages/shared/src/types/plugins.ts`
  - `packages/shared/src/types/pluginCli.ts`
  - `packages/shared/src/types/pluginContracts.ts`
  - `packages/shared/src/types/pluginPackages.ts`
- The plugin SDK lives in `plugins/sdk/src/`.
- Installed plugin registration lives in:
  - `plugins/installed/registry.config.mjs`
  - `plugins/installed/registry.helpers.mjs`
  - generated `plugins/installed/src/*.ts` files, which should be regenerated instead of hand-edited
- Backend host code owns generic transport, registry composition, auth, and routing. Start with:
  - `packages/backend/src/services/plugins/descriptors.ts`
  - `packages/backend/src/services/plugins/integrationHooks.ts`
  - `packages/backend/src/trpcRouters/plugins/index.ts`
  - `packages/backend/src/trpcRouters/plugins/generic.ts`
  - `packages/backend/src/trpcRouters/plugins/catalog.ts`
  - `packages/backend/src/trpcRouters/plugins/operations.ts`
  - `packages/backend/src/httpRoutes/plugins/registry.ts`
- Frontend host code owns generic routing and project-page scaffolding. Start with:
  - `packages/frontend/src/plugins/registry.tsx`
  - `packages/frontend/src/plugins/types.ts`
  - `packages/frontend/src/plugins/GenericProjectPluginPage.tsx`
  - `packages/frontend/src/pages/ProjectPluginPage.tsx`
  - `packages/frontend/src/pages/ProjectPlugins.tsx`
- CLI host code keeps the generic grammar in `packages/cli/src/commands.ts` and plugin registration in `packages/cli/src/plugins/registry.ts`.
- Plugin packages own manifests, backend contributions or modules, frontend pages, CLI help or formatting, public snippets, and shared UI metadata when extracted.

## Preferred Direction

- Host apps keep the generic surface.
- Plugin packages own plugin behavior.
- The CLI grammar stays generic: `vivd plugins ...`.
- Frontend routes are mounted by the host, but plugin pages and panels are plugin-owned.
- Shared UI imports inside plugins should come from `@vivd/ui`, not app-private frontend paths.
- Compatibility wrappers should stay thin. If nothing still imports them, delete them.

## Current Examples

Use a current plugin as a shape reference instead of copying old host glue:

- external plugin example: `plugins/external/google-maps/`
- native plugin examples:
  - `plugins/native/analytics/`
  - `plugins/native/contact-form/`
  - `plugins/native/newsletter/`
  - `plugins/native/table-booking/`

## Common Failure Mode

If a host workspace imports a plugin workspace package, you usually need all of these:

- the plugin added to the host `package.json`
- the root `package-lock.json` refreshed
- the plugin `package.json` copied into the relevant Docker deps or install stage
- the plugin workspace included in `npm ci -w ...`
- the plugin source copied into build or dev stages when bundling or Vite needs it
- `docker-compose.override.yml` or other local sync rules updated when local Docker dev should see plugin changes

When a plugin typechecks but fails in Docker or Vite, inspect package boundaries and container wiring before chasing app logic.

## Validation

Pick the smallest useful set:

- typecheck the touched plugin workspace
- typecheck the touched host workspaces such as `@vivd/backend`, `@vivd/frontend`, `@vivd/studio`, or `@vivd/cli`
- run focused tests for touched registries, pages, routers, or plugin backend services
- if Docker wiring changed, build the affected image or run the affected local runtime build

If you are extracting or heavily rewiring a plugin, also read [references/extraction-checklist.md](references/extraction-checklist.md).

## Project-State Note

When plugin architecture or plugin surface behavior changes, update `PROJECT_STATE.md` with a short factual note.
