# Backend Cleanup Plan (2026-01)

Actionable refactor plan to keep the backend maintainable as Vivd grows, without big-bang rewrites.

Last review: 2026-01-20

## Goals

- Keep production behavior stable while refactoring.
- Reduce “god files” and clarify module ownership/boundaries.
- Standardize env/config across **all** entrypoints (server, migrations, CLI, scripts, tests).
- Centralize filesystem + project/version access control (security + consistency).
- Make long-running work (generation/devserver/publish/agent) observable and non-blocking.

## Scope

- Express server + REST endpoints: `backend/src/server.ts`, `backend/src/routes/*`
- tRPC: `backend/src/trpc.ts`, `backend/src/routers/**`
- Auth: `backend/src/auth.ts`
- Project filesystem model/versioning: `backend/src/generator/versionUtils.ts`, `backend/src/generator/vivdPaths.ts`, `backend/src/fs/safePaths.ts`
- Long-running subsystems: `backend/src/opencode/**`, `backend/src/devserver/**`, `backend/src/services/**`
- DB + migrations: `backend/src/db/**`, `backend/drizzle/**`

## Guiding Principles (for every PR)

- Small, mechanical PRs: move code first, then improve APIs.
- One “source of truth” per concept: config/env, project paths, session/role checks, errors.
- Treat all paths from the frontend as hostile by default; never rely on `path.resolve` alone (symlinks).
- Avoid blocking the Node event loop with `execSync`/large sync FS work on request paths (or isolate it).
- Prefer “thin routers” calling services over routers doing orchestration.

## Current State (quick map)

- **HTTP entrypoint**: `backend/src/server.ts` does express wiring + proxy + uploads + downloads + static + tRPC.
- **tRPC auth & procedures**: `backend/src/trpc.ts` contains session creation and role middleware.
- **Project/version model**: `backend/src/generator/versionUtils.ts` + `backend/src/generator/vivdPaths.ts`.
- **Path hardening**: `backend/src/fs/safePaths.ts` (`safeJoin`) exists and is used in several places.
- **Long-running subsystems**:
  - Agent: `backend/src/opencode/**`
  - Dev previews: `backend/src/devserver/**`
  - Publishing: `backend/src/services/PublishService.ts`
- **Tests**: `backend/test/**` (Vitest; integration tests excluded by default).

## Findings / Refactor Targets

### P0 — Config/env drift (hard to debug)

- `dotenv` is loaded in multiple ways:
  - `backend/src/server.ts` imports `backend/src/init-env.ts` (loads repo root `.env`)
  - `backend/src/db.ts` calls `dotenv.config()` (loads from CWD)
  - `backend/drizzle.config.ts` loads `../.env`
  - some scripts call `dotenv.config()` directly
- Result: behavior differs depending on how/where you run code (tsx vs dist, repo root vs `backend/`).

### P0 — Auth/access duplication (eventual security bug)

- Project access rules exist in **two places**:
  - Express middleware in `backend/src/server.ts` (`enforceProjectAccess`)
  - tRPC middleware in `backend/src/trpc.ts` (`projectMemberProcedure`)
- These will drift (status codes, error semantics, slug parsing, future multitenant changes).

### P1 — “God file” + mixed concerns

- `backend/src/server.ts` is ~550 LOC (proxy, uploads, downloads, static, auth wiring, tRPC).
- Large subsystems concentrate logic:
  - `backend/src/services/PublishService.ts` (~620 LOC)
  - `backend/src/services/GitService.ts` (~650 LOC)
  - `backend/src/opencode/index.ts` (~490 LOC)
  - `backend/src/routers/project/generation.ts` (~520 LOC)
  - `backend/src/devserver/devServerManager.ts` (~400 LOC)

### P1 — Filesystem safety is inconsistent

- `safeJoin` exists and is used for some writes (uploads, AI image create).
- Other code still uses `path.join` + `path.resolve(...).startsWith(...)` patterns, which do not prevent symlink escapes.

### P1 — Fire-and-forget background work

- Some endpoints start work via `processUrl(...).then(...).catch(...)` and return immediately.
- This makes retries, cancellation, “already running” checks, and observability harder as features grow.

### P1 — Publishing data model mismatch risk

- `published_site.domain` is unique, but publishing logic effectively assumes “one publish record per project” (queries by `projectSlug` and `limit 1`).
- If multiple rows ever exist for a project (manual edits/migrations/bugs), behavior becomes non-deterministic.

### P2 — Error handling/logging consistency

- Mix of `throw new Error(...)`, JSON responses, and `TRPCError` usage across the codebase.
- Many `console.log`/`console.error` calls make production logs noisy and unstructured.

## Target Structure (end-state)

Keep this minimal and pragmatic (no DDD big rewrite). Suggested folders:

- `backend/src/config/` – env loading + typed config (`env.ts`, `paths.ts`)
- `backend/src/http/` – express app wiring, middleware, REST routes
- `backend/src/api/trpc/` – context, role middleware, router composition
- `backend/src/modules/` – feature modules owning business logic:
  - `projects/` (manifest + version dirs + status)
  - `assets/` (fs ops + AI image ops)
  - `publishing/` (domain validation + caddy + filesystem publishing)
  - `agent/` (opencode facade)
  - `devpreview/` (dev server orchestration)
  - `usage/` (UsageService + LimitsService)
- `backend/src/lib/` – shared primitives (errors, logger, fs/path)

## Execution Plan (incremental PRs)

### Phase 0 — Baseline & guardrails (prep)

- [ ] Write “backend rules” in this doc (or `backend/README.md`):
  - no raw `process.env.*` outside `config/env.ts`
  - all project-relative paths go through one API (e.g. `projectFs`)
  - routers are thin (validation + call service)
  - avoid `execSync` on request path
- [ ] Add a small “smoke checklist” for humans (no automated paid calls):
  - start stack, login, create project, preview, publish, upload, agent run

Acceptance: new PRs follow the rules; no code change yet.

### Phase 1 — Unified config/env (P0)

- [ ] Create `backend/src/config/env.ts` (zod validated) + `backend/src/config/paths.ts`:
  - load env in exactly one place
  - expose `getProjectsDir()`, `getPublishedDir()`, `domain`, `corsOrigins`, etc.
- [ ] Ensure **every** entrypoint imports env exactly once:
  - `backend/src/server.ts`
  - `backend/src/db/migrate.ts`
  - `backend/src/generator/cli.ts`
  - `backend/src/db.ts` (remove local `dotenv.config()` usage)
  - `backend/drizzle.config.ts`
  - `backend/scripts/*` (if kept)
- [ ] Document “where env comes from” for local vs Docker (mounted env vars vs `.env`).

Acceptance: running via `tsx`, `node dist/*`, and drizzle config all read identical config values.

### Phase 2 — Centralize auth + project access (P0)

- [ ] Extract session helpers:
  - `getSessionFromRequest(req)` (Express)
  - `requireSession(ctx)` (tRPC)
- [ ] Extract role checks and project assignment checks into one module:
  - `assertCanAccessProject({ session, slug })`
  - `assertIsAdmin(session)` / `assertIsOwner(session)`
- [ ] Reuse the same logic from both Express middleware and tRPC middleware.
- [ ] Standardize 401 vs 403 semantics (and match frontend expectations).

Acceptance: there is exactly one implementation of “client_editor project scoping”.

### Phase 3 — Split `server.ts` into HTTP modules (P1)

- [ ] Create `backend/src/http/app.ts` that builds an express app:
  - middleware (cors, json)
  - auth handler wiring
  - REST routes: upload, download, import, devpreview proxy, static serving, health
  - tRPC mount
- [ ] Keep `backend/src/server.ts` as the process entrypoint (listen + shutdown hooks only).
- [ ] Move devpreview proxy code into `backend/src/http/routes/devpreview.ts`.
- [ ] Move upload/download into `backend/src/http/routes/assetsUpload.ts` / `download.ts`.

Acceptance: `server.ts` is ~50–100 LOC; route files are individually reviewable.

### Phase 4 — One filesystem safety API (P1)

- [ ] Define a single “project filesystem” helper, e.g. `backend/src/modules/projects/projectFs.ts`:
  - `resolveVersionPath(slug, version)` (already exists conceptually)
  - `safeResolve(versionDir, relPath)` (wraps `safeJoin`)
  - `readTextFile`, `writeTextFile`, `ensureDir`, `listAssets` (as needed)
- [ ] Replace all ad-hoc `path.resolve(...).startsWith(...)` checks with the shared helper.
- [ ] Add unit tests for traversal + symlink behavior (cheap, local-only).

Acceptance: any path coming from the frontend touches `safeJoin` (or a wrapper) before IO.

### Phase 5 — Long-running work orchestration (P1)

Minimum viable step (no external queue):

- [ ] Introduce an in-process “jobs registry”:
  - job id, type (generate/publish/devserver-install/build), status, timestamps, error
  - persist minimal status to `.vivd/project.json` / manifest where appropriate
- [ ] Replace fire-and-forget `.then/.catch` chains with “enqueue job” calls.
- [ ] Add job status endpoints (tRPC) for polling (if needed).

Future step (when multitenant/scale requires it):

- [ ] Replace in-process jobs with a durable queue (BullMQ/Redis or Postgres-backed).

Acceptance: generation/publish/devserver work is observable and doesn’t silently fail.

### Phase 6 — Decompose large services (P1/P2)

- [ ] `PublishService`:
  - extract `DomainValidator`, `CaddyConfigWriter`, `PublisherFs` (copy/build), `PublishRepository` (db)
- [ ] `opencode/index.ts`:
  - split “client API”, “event stream”, “usage recording”, “status normalization”
- [ ] `GitService`:
  - split GitHub sync concerns into a separate module
- [ ] `DevServerManager`:
  - remove `execSync` where feasible (use async child process) or isolate installs/builds from request path

Acceptance: services become composable and testable with small unit tests around pure parts.

### Phase 7 — Data model correctness + migrations (P1)

- [ ] Decide publishing model explicitly:
  - **Option A (recommended now): one domain per project** → add unique constraint on `published_site.project_slug`
  - Option B: multiple domains per project → change `PublishService` upsert logic and API
- [ ] Add a startup integrity check (warn + metric/log) if duplicates exist.
- [ ] Document invariants in code (types + runtime guards).

Acceptance: DB constraints match the code’s assumptions.

### Phase 8 — Error handling + logging consistency (P2)

- [ ] Create `backend/src/lib/errors.ts`:
  - map to `TRPCError` codes and express HTTP statuses
  - helper to normalize unknown errors
- [ ] Create `backend/src/lib/logger.ts`:
  - structured logs, debug toggles (env)
- [ ] Replace scattered `console.*` with logger calls (keep logs, improve signal).

Acceptance: errors are predictable for the frontend; logs are actionable in prod.

### Phase 9 — Dependency/script hygiene (P2)

- [ ] Consolidate scripts: decide `backend/scripts/**` vs `backend/src/scripts/**` and stick to one.
- [ ] Remove unused dependencies after verifying with a quick grep/build (e.g. if `@openrouter/sdk` truly unused).
- [ ] Keep integration tests behind an explicit flag (already excluded by default in Vitest config).

Acceptance: fewer “mystery” scripts and less risk of accidental paid calls.

## Open Decisions (please choose before Phase 7)

- Publishing: **one domain per project** vs **multiple domains per project**?
- Should client_editors be allowed to access `.vivd/` artifacts (currently possible via some surfaces)?
- Should any dotfiles be allowed in published output besides `.well-known/`?

## Suggested PR breakdown (example)

1) `config/env.ts` + update entrypoints  
2) auth/access helpers + reuse in Express + tRPC  
3) split HTTP routes out of `server.ts`  
4) introduce `projectFs` wrapper + replace path checks  
5) job registry for generation/publish/devserver work  
6) publishing model constraint + migration  
7) logging/error normalization pass
