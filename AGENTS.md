# Vivd (Monorepo)

Vivd is an AI-powered website builder: generate a site, preview/edit it in the studio, and publish it via Caddy.

## Project State & Roadmap

See **`docs/PROJECT_STATE.md`** for the current implementation roadmap, progress tracking, and open decisions.

**Important:** When the plan changes or tasks are completed, update `docs/PROJECT_STATE.md` to reflect the current state.

## Repo Layout

Vivd uses an npm workspaces monorepo (`package.json` at repo root, one root `package-lock.json`).

- `packages/backend`: Express + tRPC, Better Auth, Drizzle migrations, OpenCode agent integration. Serves project files and manages publishing (writes Caddy snippets + reloads Caddy).
- `packages/frontend`: React + Vite studio UI. Uses tRPC, shadcn/ui, `react-hook-form`. Tailwind design tokens come from `@vivd/theme`.
- `packages/scraper`: Dedicated Express + Puppeteer service (called by backend).
- `packages/shared`: Shared types + SaaS mode config (`SAAS_MODE`, `CONTROL_PLANE_*`) for the studio backend.
- `packages/theme`: Shared CSS variables/themes for any frontend apps.
- `legacy/control-panel`: Legacy/previous control-panel attempt (not the planned SaaS control plane).

## Generated Sites

The generator produces plain HTML (`index.html`) files by default. We also support Astro projects, which can be built and served by the devserver.

## Package Manager Rules

- Install deps at repo root; avoid per-package `package-lock.json` files.
- Run package scripts via workspaces, e.g. `npm run build -w @vivd/backend`.

## Docker / Local Dev

- `docker-compose.yml` is the base stack; `docker-compose.override.yml` is local dev overrides.
- Local URLs (via Caddy): studio at `http://localhost/vivd-studio`, published sites at `http://localhost/`.
- `docker-compose.self-hosted.yml` is the self-hosted production compose (GHCR images, `SAAS_MODE=false`).

## DB / Migrations

- Drizzle migrations only. Do not use `drizzle-kit push` / `db:push`.


## Testing Note

- Avoid running full test suites frequently (some workflows are long-running / use paid APIs). Prefer targeted builds and minimal checks.

## GIT

- DO NOT COMMIT or PUSH code. Just change and let me handle git. You can use other git commands to help you understand the codebase.

## Studio Image Debugging (GHCR dev tags)

- We can use the `scripts/push-studio.sh` (push-image) helper to push a `dev-*` studio image to GHCR for quick debugging without cutting a full release tag.
  - Example: `./scripts/push-studio.sh dev-0.3.34` (or run with no args to push `dev-<gitsha>`).
- In **Super Admin → Machines**, select the `dev-*` tag in the **Studio image** dropdown and run **Reconcile now** to roll studio machines to that image.
- Select **Latest (auto)** to clear the pin and go back to the latest semver image.
- If `FLY_STUDIO_IMAGE` is set in the backend environment, the selector is locked (env wins).
- you can ask the user to help you with testing this
