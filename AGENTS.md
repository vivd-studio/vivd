# Vivd (Monorepo)

Vivd is an AI-powered website builder: generate a site, preview/edit it in Studio, and publish it via Caddy.

## Project State & Roadmap

See `PROJECT_STATE.md` for active roadmap, priorities, and open decisions.

When plans change or work is completed, update `PROJECT_STATE.md` in the same change.
If `PROJECT_STATE.md` starts accumulating too much closed-out detail again, suggest trimming it and moving older material into `docs/PROJECT_STATE_ARCHIVE.md`.

## Core Architecture

Vivd uses npm workspaces (`package.json` at repo root, single root `package-lock.json`).

- `packages/backend`: control-plane backend (Express + tRPC, Better Auth, Drizzle migrations, publish/domain orchestration, studio machine orchestration).
- `packages/docs`: public product docs site (Astro/Starlight).
- `packages/frontend`: control-plane React UI.
- `packages/plugin-analytics`: first extracted internal plugin package; owns Analytics-specific backend/frontend/CLI module entrypoints and compatibility exports.
- `packages/plugin-contact-form`: extracted internal plugin package for Contact Form; owns Contact Form-specific backend/frontend/CLI module entrypoints and shared UI metadata, with thin host adapters left in backend/frontend/CLI.
- `packages/studio`: isolated studio runtime (server + client) for workspace edits and agent operations.
- `packages/scraper`: dedicated Express + Puppeteer scraping service.
- `packages/shared`: shared config/types used across services.
- `packages/theme`: shared CSS variables/theme tokens.
- If a change affects user-facing behavior, consider updating `packages/docs` or suggesting the right docs section.

## Ownership Boundaries (Important)

- Studio file patching/edit logic (HTML/Astro/i18n patching) belongs in `packages/studio` runtime paths.
- Keep backend and studio responsibilities separated; avoid duplicating runtime patching logic across both.
- Frontend should not depend on backend internals via ad-hoc local path aliases; prefer explicit shared contracts.
- Shared plugin contracts now live in `packages/shared/src/types/pluginContracts.ts`, while shared UI types/helpers live in `packages/shared/src/types/plugins.ts`.
- Direct plugin affordances such as icons, shortcut labels, route targets, and activation prompts should be plugin-owned when possible (for example `packages/plugin-analytics/src/shared/projectUi.ts`) and then registered by the host UI layers instead of hardcoding `analytics`/other plugin checks into host pages or Studio chrome.
- Control-plane frontend resolves shared plugin UI through `packages/frontend/src/plugins/sharedUiRegistry.ts` + `packages/frontend/src/plugins/shortcuts.ts`, while Studio client resolves the same plugin-owned metadata through `packages/studio/client/src/plugins/sharedUiRegistry.ts` + `packages/studio/client/src/plugins/shortcuts.ts`.
- Internal plugins should now move toward real workspace-package ownership. Analytics and Contact Form now live in `packages/plugin-analytics` and `packages/plugin-contact-form`, including their plugin-owned backend config/module factories, deeper backend runtime/public-route code, shared UI metadata, frontend pages, CLI descriptors, and backend admin/org hooks, while host paths under `packages/backend/src/services/plugins/*/module.ts`, `packages/frontend/src/plugins/*/module.ts`, `packages/backend/src/trpcRouters/plugins/*`, and `packages/backend/src/httpRoutes/plugins/*` should stay as thin adapters, registries, or compatibility wrappers.
- Generic backend plugin host helpers now live in `packages/backend/src/trpcRouters/plugins/operations.ts`; keep plugin-specific public error translation inside the plugin module files instead of reintroducing contact/analytics-specific error handling in shared routers.
- The plugin-specific public routers under `packages/backend/src/trpcRouters/plugins/contactForm.ts` and `packages/backend/src/trpcRouters/plugins/analytics.ts` are compatibility adapters. Keep them thin and route shared lifecycle/config/action flows through the generic operations layer; extracted plugin packages should not import `@vivd/backend/src/...` just to provide those legacy procedures.
- Backend host-only product integrations that still need plugin-owned behavior, such as organization overview enrichment or super-admin entitlement side effects, should go through `packages/backend/src/services/plugins/integrationHooks.ts` and plugin-package exports instead of growing new `if (pluginId === "...")` branches inside host routers.
- Keep compatibility wrappers/routes only as thin adapters. New plugin-owned UI or backend behavior should go into the per-plugin module files first, not into host-page/service switch statements.
- When a host workspace imports a plugin workspace package, declare that plugin package in the host `package.json` and update any Docker workspace-install contexts (`package.json` copies, `npm ci -w ...`, and source copies where needed). Otherwise local typecheck can pass while Docker/runtime builds fail with missing workspace packages.

## Upstream Reference Checkouts

- Keep local upstream/reference repos under `vendor/`; this is the established path for agent-readable external code in this repo.
- These checkouts are for reference, comparison, and selective borrowing. They are not workspace packages or runtime dependencies.
- For external live/generated site repos that are being inspected alongside Vivd, prefer `vendor/sites/<repo-name>` so they stay clearly separate from the product codebase and from upstream framework references.
- Current paths:
  - `vendor/opencode`: upstream OpenCode reference checkout (`https://github.com/anomalyco/opencode`).
  - `vendor/dokploy`: upstream Dokploy reference checkout (`https://github.com/Dokploy/dokploy`) for self-hosting/hosting patterns Vivd may reuse while still running directly on its own server/runtime.
  - `vendor/dyad`: upstream Dyad reference checkout (`https://github.com/dyad-sh/dyad`) for local-first AI app-builder product, packaging, and paid/open-source boundary comparisons.
  - `vendor/betterlytics`: upstream Betterlytics reference checkout (`https://github.com/betterlytics/betterlytics`) for privacy-focused analytics product, ingestion, and dashboard ideas Vivd may study while shaping its own analytics direction.
- If an upstream reference checkout is added, moved, or replaced, update this file and `PROJECT_STATE.md` in the same change so the agent can rely on stable paths.

## OpenCode Studio Tools / Studio CLI

- Reference checkout: `vendor/opencode` (upstream: `https://github.com/anomalyco/opencode`).
- When this repo says "OpenCode web" or refers to the UI started by `opencode web`, that means the actual web app in `vendor/opencode/packages/app`; `vendor/opencode/packages/web` is the docs site, and the CLI entrypoint lives at `vendor/opencode/packages/opencode/src/cli/cmd/web.ts`.
- Preferred agent surface for connected runtime/platform operations is the Studio-machine `vivd` CLI in `packages/cli`.
- Shared CLI/backend transport helper lives in `packages/shared/src/studio/connectedBackendClient.ts`.
- The `vivd` CLI is how the agent inspects runtime/project context and interacts with platform-managed features such as plugins and the publish checklist.
- Interaction with the Vivd platform outside normal file/code editing capabilities should go through the `vivd` CLI rather than dedicated custom OpenCode wrappers wherever possible.
- Keep experimental Vivd CLI surfaces feature-flagged and undiscoverable by default until they are intentionally exposed.
- Prefer the generic plugin CLI surface for discovery and execution: `vivd plugins catalog`, `vivd plugins info <pluginId>`, `vivd plugins config show|template|apply <pluginId>`, and `vivd plugins action <pluginId> <actionId> ...`.
- Current first-party compatibility aliases such as `vivd plugins contact ...` and `vivd plugins analytics info` still work, but they should not be treated as the long-term contract.
- Use the CLI help surface to discover exact subcommands when needed: `vivd help`, `vivd plugins help`, and `vivd publish help`.
- Treat `vivd publish checklist run` as an explicit full checklist pass, not a routine test command; prefer item-by-item checklist work unless the user explicitly asked for a full run or rerun.
- Treat `.vivd/dropped-images/` as ephemeral working storage; Studio keeps only the latest 10 files there, so move anything worth keeping into the project tree.
- For `STUDIO_MACHINE_PROVIDER=local`, `packages/backend/src/services/studioMachines/local.ts` is responsible for making `vivd` available inside spawned Studio runtimes by wiring a local wrapper into the child-process `PATH`.
- The only remaining custom OpenCode tool on the agent surface is `vivd_image_ai`; plugin, preview-screenshot, checklist, and similar platform operations should go through the CLI.
- Runtime install point: `packages/studio/server/opencode/serverManager.ts` writes tool wrappers to `~/.config/opencode/tools/` before `opencode serve`.
- Tool source of truth: `packages/studio/server/opencode/toolRegistry.ts` + `packages/studio/server/opencode/toolModules/*.ts`.
- Managed custom tool: `vivd_image_ai`.
- Tool gating is centralized in `packages/studio/server/opencode/configPolicy.ts` via `VIVD_OPENCODE_TOOLS_ENABLE`, `VIVD_OPENCODE_TOOLS_DISABLE`, `VIVD_OPENCODE_TOOL_FLAGS`, plus role/plugin context envs.
- Adding a tool: add typed module, register in tool registry, keep `execute` minimal and safe, and verify in connected mode.

## Generated Sites

The generator outputs plain HTML (`index.html`) by default. Astro projects are also supported and can be built/served by the devserver.

## Package Manager Rules

- Install dependencies at repo root.
- Avoid per-package lockfiles.
- Run scripts via workspaces, e.g. `npm run build -w @vivd/backend`.

## Docker / Local Dev

- `docker-compose.yml`: base stack.
- `docker-compose.override.yml`: local dev overrides.
- `docker-compose.prod.yml`: production compose variant for platform/hosted-style deployments. It is not the public `solo` self-host install bundle.
- `packages/docs/public/install/docker-compose.yml`: source of truth for the public `solo` self-host install bundle that the docs/install flow downloads and runs.
- Install profiles: public self-host/install docs currently focus on `solo` = one host (`/`, `/vivd-studio`, same-host `/plugins/*`). `platform` is the multi-org host-based mode used for the hosted product and platform-style deployments.
- Licensing guardrail: the repo `LICENSE` Additional Use Grant covers `solo` and substantially similar single-tenant self-host deployments. Do not casually surface, default, or recommend `platform` or other multi-org/shared-control-plane behavior for general self-host flows; treat that as a separately licensed platform deployment.

- Local URLs via Caddy:
  - Studio/control-plane route: `http://localhost/vivd-studio`
  - Published-site host: `http://localhost/`
  - Public plugin API host (dev): `http://api.localhost` (`/plugins/*` → backend)
- For local public-plugin URL generation, set `VIVD_PUBLIC_PLUGIN_API_BASE_URL=http://api.localhost` (default is `https://api.vivd.studio`).
- For staged/prod public plugin host routing in Caddy, set `VIVD_PUBLIC_PLUGIN_API_HOST` (default `api.vivd.studio`).

## Studio Machines (Prod)

- In production, Studio runtimes run on Fly Machines.
- Machines are started/reused per project (scoped by organization + project slug) via backend orchestration.
- For Fly-specific Studio lifecycle/debugging rules and drift/cold-start findings, see `.agents/skills/fly-studio-machines/SKILL.md`.

## DB / Migrations

- Drizzle migrations only.
- Allowed flow: `db:generate` + `db:migrate`.
- Do not use `drizzle-kit push` / `db:push`.

## Testing Note

- Avoid running full suites frequently (some flows are long-running and/or paid-API dependent).
- Prefer targeted tests/builds for touched areas.
- During substantial multi-file work or refactors, run the relevant TypeScript check periodically (`npm run typecheck` or a workspace-level `npm run typecheck -w <workspace>`) instead of only at the end.
- Create MEANINGFUL tests, we are not interested in coverage, we want to add tests that actually add value to the codebase.
- Shared GitHub Actions validation lives in `.github/workflows/reusable-validate.yml`; `validate.yml` uses it for PR/main CI, and publish workflows use it as the release gate before image push.
- Release flow is `npm run publish:tag` (`scripts/publish.sh`) first, then tag-triggered GitHub workflow validation + image smoke tests. For release-impacting changes, agents should proactively suggest the right targeted regression tests or smoke checks so they land in that pipeline before shipping, so that our pipline becomes more robust over time.

## Git

- Do not commit or push; make working-tree changes only. (Unless specifically requested by the user.)
- Git commands for inspection are fine.
- When suggesting commit messages, prefer conventional commits like `fix(scope): ...`, `refactor(scope): ...`, or `chore(scope): ...` with a rough package/area scope, and only suggest one if the latest changes feel genuinely validated and committable; otherwise say they are not ready to commit yet.

## Studio Image Debugging (GHCR dev tags)

- This is important when testing fly-specific behavior, because the state of the codebase is not necessarily the same as the state of the studio code running on the machine.
- Push a temporary Studio image: `./scripts/push-studio.sh [dev-tag]`
  - Example: `./scripts/push-studio.sh dev-0.3.34`
  - No arg: pushes `dev-<gitsha>`
- In Super Admin → Machines:
  - Select a `dev-*` tag in **Studio image** and run **Reconcile now** to roll machines.
  - Select **Latest (auto)** to clear pinning.
- If `FLY_STUDIO_IMAGE` is set in backend env, the selector is locked (env override wins).
- Ask the user to help with runtime verification if needed.

## Config

- add (optional) config knobs to .env.example
