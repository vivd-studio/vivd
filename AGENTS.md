# Vivd (Monorepo)

Vivd is an AI-powered website builder: generate a site, preview/edit it in the studio, and publish it via Caddy.

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
