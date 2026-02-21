# Vivd (Monorepo)

Vivd is an AI-powered website builder: generate a site, preview/edit it in Studio, and publish it via Caddy.

## Project State & Roadmap

See `docs/PROJECT_STATE.md` for active roadmap, priorities, and open decisions.

When plans change or work is completed, update `docs/PROJECT_STATE.md` in the same change.

## Core Architecture

Vivd uses npm workspaces (`package.json` at repo root, single root `package-lock.json`).

- `packages/backend`: control-plane backend (Express + tRPC, Better Auth, Drizzle migrations, publish/domain orchestration, studio machine orchestration).
- `packages/frontend`: control-plane React UI.
- `packages/studio`: isolated studio runtime (server + client) for workspace edits and agent operations.
- `packages/scraper`: dedicated Express + Puppeteer scraping service.
- `packages/shared`: shared config/types used across services.
- `packages/theme`: shared CSS variables/theme tokens.

## Ownership Boundaries (Important)

- Studio file patching/edit logic (HTML/Astro/i18n patching) belongs in `packages/studio` runtime paths.
- Keep backend and studio responsibilities separated; avoid duplicating runtime patching logic across both.
- Frontend should not depend on backend internals via ad-hoc local path aliases; prefer explicit shared contracts.

## OpenCode Studio Tools

- Use OpenCode custom tools to provide agent capabilities that are not available via built-in tools (plugin operations, Vivd workflows, external integrations, structured project automation).
- Target tool namespace: `vivd_plugins_*` for custom Vivd capabilities exposed to the agent; bootstrap `vivd_test` has been retired.
- Implementation location: `packages/studio/server/opencode/serverManager.ts` provisions tool files into Studio runtime global tools at `~/.config/opencode/tools/` before `opencode serve` starts.
- Tool registry/module location: `packages/studio/server/opencode/toolRegistry.ts` + `packages/studio/server/opencode/toolModules/*.ts`.
- Initial plugin tools:
  - `vivd_plugins_catalog` → list plugin catalog + enabled instances for current project.
  - `vivd_plugins_contact_info` → return contact-form plugin status, token/snippets (if enabled), and implementation instructions.
- Backend capability surface for these tools lives in `packages/backend/src/routers/plugins.ts` and `packages/backend/src/services/plugins/ProjectPluginService.ts`.
- Public website-facing plugin runtime endpoints should use `https://api.vivd.studio/plugins/...` (or `VIVD_PUBLIC_PLUGIN_API_BASE_URL` override) via `packages/backend/src/services/plugins/publicApi.ts`; internal authenticated management stays on backend tRPC (`/vivd-studio/api/trpc/...`).
- Conditional tool enable/disable is policy-driven at Studio startup:
  - env overrides: `VIVD_OPENCODE_TOOLS_ENABLE`, `VIVD_OPENCODE_TOOLS_DISABLE`, `VIVD_OPENCODE_TOOL_FLAGS` (JSON booleans),
  - context envs passed from backend: `VIVD_ORGANIZATION_ROLE`, `VIVD_ENABLED_PLUGINS`,
  - merged into OpenCode config tool toggles via `packages/studio/server/opencode/configPolicy.ts`.
- When adding a tool:
  1. Add a typed tool module under `packages/studio/server/opencode/toolModules/` and register it in `packages/studio/server/opencode/toolRegistry.ts` with a stable name (prefer `vivd_plugins_<action>` for plugin tools).
  2. In tool `execute`, implement only the minimum required capability path (backend API, local workspace logic, or external API), and use connected-mode auth/scope envs when calling Vivd backend (`MAIN_BACKEND_URL`, `SESSION_TOKEN`, `VIVD_TENANT_ID`, `VIVD_PROJECT_SLUG`).
  3. Keep outputs safe (no secrets), return concise structured text, then verify the tool is callable by the agent in connected mode.

## Generated Sites

The generator outputs plain HTML (`index.html`) by default. Astro projects are also supported and can be built/served by the devserver.

## Package Manager Rules

- Install dependencies at repo root.
- Avoid per-package lockfiles.
- Run scripts via workspaces, e.g. `npm run build -w @vivd/backend`.

## Docker / Local Dev

- `docker-compose.yml`: base stack.
- `docker-compose.override.yml`: local dev overrides.
- `docker-compose.self-hosted.yml`: self-hosted production compose (`SAAS_MODE=false`, GHCR images).
- Local URLs via Caddy:
  - Studio/control-plane route: `http://localhost/vivd-studio`
  - Published-site host: `http://localhost/`

## DB / Migrations

- Drizzle migrations only.
- Allowed flow: `db:generate` + `db:migrate`.
- Do not use `drizzle-kit push` / `db:push`.

## Testing Note

- Avoid running full suites frequently (some flows are long-running and/or paid-API dependent).
- Prefer targeted tests/builds for touched areas.

## Git

- Do not commit or push; make working-tree changes only.
- Git commands for inspection are fine.

## Studio Image Debugging (GHCR dev tags)

- Push a temporary Studio image: `./scripts/push-studio.sh [dev-tag]`
  - Example: `./scripts/push-studio.sh dev-0.3.34`
  - No arg: pushes `dev-<gitsha>`
- In Super Admin → Machines:
  - Select a `dev-*` tag in **Studio image** and run **Reconcile now** to roll machines.
  - Select **Latest (auto)** to clear pinning.
- If `FLY_STUDIO_IMAGE` is set in backend env, the selector is locked (env override wins).
- Ask the user to help with runtime verification if needed.
