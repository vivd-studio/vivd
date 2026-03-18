# Vivd (Monorepo)

Vivd is an AI-powered website builder: generate a site, preview/edit it in Studio, and publish it via Caddy.

## Project State & Roadmap

See `docs/PROJECT_STATE.md` for active roadmap, priorities, and open decisions.

When plans change or work is completed, update `docs/PROJECT_STATE.md` in the same change.

## Core Architecture

Vivd uses npm workspaces (`package.json` at repo root, single root `package-lock.json`).

- `packages/backend`: control-plane backend (Express + tRPC, Better Auth, Drizzle migrations, publish/domain orchestration, studio machine orchestration).
- `packages/docs`: public product docs site (Astro/Starlight).
- `packages/frontend`: control-plane React UI.
- `packages/studio`: isolated studio runtime (server + client) for workspace edits and agent operations.
- `packages/scraper`: dedicated Express + Puppeteer scraping service.
- `packages/shared`: shared config/types used across services.
- `packages/theme`: shared CSS variables/theme tokens.
- If a change affects user-facing behavior, consider updating `packages/docs` or suggesting the right docs section.

## Ownership Boundaries (Important)

- Studio file patching/edit logic (HTML/Astro/i18n patching) belongs in `packages/studio` runtime paths.
- Keep backend and studio responsibilities separated; avoid duplicating runtime patching logic across both.
- Frontend should not depend on backend internals via ad-hoc local path aliases; prefer explicit shared contracts.

## OpenCode Studio Tools

- Local upstream checkout for reference: `vendor/opencode` (upstream: `https://github.com/anomalyco/opencode`).
- OpenCode web split: docs live in `vendor/opencode/packages/web`, the actual web client UI is `vendor/opencode/packages/app`, and the `opencode web` CLI entrypoint is `vendor/opencode/packages/opencode/src/cli/cmd/web.ts`.
- Purpose: expose custom Vivd capabilities to the agent (namespace `vivd_*`).
- Runtime install point: `packages/studio/server/opencode/serverManager.ts` writes tool wrappers to `~/.config/opencode/tools/` before `opencode serve`.
- Tool source of truth: `packages/studio/server/opencode/toolRegistry.ts` + `packages/studio/server/opencode/toolModules/*.ts`.
- Current tools: `vivd_plugins_catalog`, `vivd_plugins_contact_info`, `vivd_plugins_analytics_info`, `vivd_publish_checklist`, `vivd_image_ai`.
- The agent can use "_info" tools to get general info on how to use the plugin on the website, even including (public) tokens (e.g. for contact forms), and other relevant information.
- Backend surface for plugin tools: `packages/backend/src/trpcRouters/plugins/index.ts` + `packages/backend/src/services/plugins/ProjectPluginService.ts`.
- Backend surface for publish-checklist tool: `packages/backend/src/trpcRouters/project/publish.ts` (`project.publishChecklist`, `project.updatePublishChecklistItem`).
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
- `docker-compose.prod.yml`: production compose variant.
- Local URLs via Caddy:
  - Studio/control-plane route: `http://localhost/vivd-studio`
  - Published-site host: `http://localhost/`
  - Public plugin API host (dev): `http://api.localhost` (`/plugins/*` → backend)
- For local public-plugin URL generation, set `VIVD_PUBLIC_PLUGIN_API_BASE_URL=http://api.localhost` (default is `https://api.vivd.studio`).
- For staged/prod public plugin host routing in Caddy, set `VIVD_PUBLIC_PLUGIN_API_HOST` (default `api.vivd.studio`).

## Studio Machines (Prod)

- In production, Studio runtimes run on Fly Machines.
- Machines are started/reused per project (scoped by organization + project slug) via backend orchestration.

## DB / Migrations

- Drizzle migrations only.
- Allowed flow: `db:generate` + `db:migrate`.
- Do not use `drizzle-kit push` / `db:push`.

## Testing Note

- Avoid running full suites frequently (some flows are long-running and/or paid-API dependent).
- Prefer targeted tests/builds for touched areas.
- Create MEANINGFUL tests, we are not interested in coverage, we want to add tests that actually add value to the codebase.

## Git

- Do not commit or push; make working-tree changes only.
- Git commands for inspection are fine.

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
