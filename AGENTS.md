# Vivd (Monorepo)

Vivd is an AI-powered website builder: generate a site, preview/edit it in Studio, and publish it via Caddy.

## Project State & Roadmap

See `docs/PROJECT_STATE.md` for active roadmap, priorities, and open decisions.

When plans change or work is completed, update `docs/PROJECT_STATE.md` in the same change.
If `docs/PROJECT_STATE.md` starts accumulating too much closed-out detail again, suggest trimming it and moving older material into `docs/PROJECT_STATE_ARCHIVE.md`.

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

## Upstream Reference Checkouts

- Keep local upstream/reference repos under `vendor/`; this is the established path for agent-readable external code in this repo.
- These checkouts are for reference, comparison, and selective borrowing. They are not workspace packages or runtime dependencies.
- For external live/generated site repos that are being inspected alongside Vivd, prefer `vendor/sites/<repo-name>` so they stay clearly separate from the product codebase and from upstream framework references.
- Current paths:
  - `vendor/opencode`: upstream OpenCode reference checkout (`https://github.com/anomalyco/opencode`).
  - `vendor/dokploy`: upstream Dokploy reference checkout (`https://github.com/Dokploy/dokploy`) for self-hosting/hosting patterns Vivd may reuse while still running directly on its own server/runtime.
  - `vendor/dyad`: upstream Dyad reference checkout (`https://github.com/dyad-sh/dyad`) for local-first AI app-builder product, packaging, and paid/open-source boundary comparisons.
- If an upstream reference checkout is added, moved, or replaced, update this file and `docs/PROJECT_STATE.md` in the same change so the agent can rely on stable paths.

## OpenCode Studio Tools

- Reference checkout: `vendor/opencode` (upstream: `https://github.com/anomalyco/opencode`).
- When this repo says "OpenCode web" or refers to the UI started by `opencode web`, that means the actual web app in `vendor/opencode/packages/app`; `vendor/opencode/packages/web` is the docs site, and the CLI entrypoint lives at `vendor/opencode/packages/opencode/src/cli/cmd/web.ts`.
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
- Install profiles: default `solo` = one host (`/`, `/vivd-studio`, same-host `/plugins/*`); set `VIVD_INSTALL_PROFILE=platform` for the SaaS/multi-org host-based mode.
- Local URLs via Caddy:
  - Studio/control-plane route: `http://localhost/vivd-studio`
  - Published-site host: `http://localhost/`
  - Public plugin API host (dev): `http://api.localhost` (`/plugins/*` → backend)
- For local public-plugin URL generation, set `VIVD_PUBLIC_PLUGIN_API_BASE_URL=http://api.localhost` (default is `https://api.vivd.studio`).
- For staged/prod public plugin host routing in Caddy, set `VIVD_PUBLIC_PLUGIN_API_HOST` (default `api.vivd.studio`).

## Studio Machines (Prod)

- In production, Studio runtimes run on Fly Machines.
- Machines are started/reused per project (scoped by organization + project slug) via backend orchestration.
- For Fly-specific Studio lifecycle/debugging rules and drift/cold-start findings, see `.skills/FLY_STUDIO_MACHINES.md`.

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
