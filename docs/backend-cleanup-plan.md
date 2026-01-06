# Backend Review & Cleanup Plan

This document captures the backend refactor/cleanup work to improve safety, consistency, and maintainability as Vivd grows.

## Goals

- Eliminate high-risk security issues (path traversal, private file exposure).
- Make core backend modules smaller and easier to reason about.
- Standardize config/env behavior across local + Docker.
- Reduce duplication (slug/version/path validation) and centralize it.
- Keep changes incremental and easy to review.

## Scope

- API server + routers: `backend/src/server.ts`, `backend/src/routers/*`, `backend/src/routes/*`
- Generation flows + utilities: `backend/src/generator/**`
- Services: `backend/src/services/**`
- Auth + tRPC context: `backend/src/auth.ts`, `backend/src/trpc.ts`
- DB layer + migrations: `backend/src/db/**`, `backend/drizzle/**`

## Guiding Principles

- Prefer small, mechanical PRs with minimal behavior change.
- Fix root causes (shared helpers) instead of repeating “inline” checks.
- Treat any file-system access as untrusted input by default.
- Keep “site files” (public) separate from “process artifacts” (private: `.vivd/`, `.git/`).

## Findings (from initial review)

### P0 — Security / Data Exposure

- Path traversal write in `backend/src/routers/assetsRouter.ts` (`createImageWithAI` `targetPath` and `referenceImages`).
- Symlink escape possible in `backend/src/server.ts` upload endpoint (prefix check uses non-resolved path).
- Publishing copies private files to the public directory (`backend/src/services/PublishService.ts` copies dotfiles, `.vivd/`).

### P1 — Correctness / Data Model

- DB schema inconsistency: `published_site.published_by_id` is `notNull` but FK is `onDelete: "set null"` (`backend/src/db/schema.ts`).
- Publishing model unclear: table enforces unique `domain`, service upserts by `projectSlug`. Need a decision: “one domain per project” vs “many domains per project”.

### P1 — Maintainability

- Routers are large monoliths:
  - `backend/src/routers/project.ts` (~1200 LOC)
  - `backend/src/routers/agent.ts` (~680 LOC)
  - `backend/src/routers/assetsRouter.ts` (~550 LOC)
- Duplicate slug logic exists in multiple places (`backend/src/routes/import.ts`, `backend/src/generator/core/context.ts`).
- Repeated “version dir exists + safe join” patterns across routers.

### P2 — Config / DX / Consistency

- Env var mismatch: code expects `_OPENROUTER_API_KEY`, `backend/entrypoint.sh` checks `OPENROUTER_API_KEY`. (Fixed: now uses `OPENROUTER_API_KEY`.)
- Static serving uses `../projects` path directly, while other logic supports `PROJECTS_DIR` (`backend/src/server.ts` vs `backend/src/generator/versionUtils.ts`).
- `@openrouter/sdk` appears unused in backend code (verify and remove if confirmed).
- `backend/test/` exists but `backend/package.json` test script is a stub (either wire up or remove/relocate).

## Plan

### Phase 1 — Security hardening (P0)

- [x] Add a shared helper for safe paths, e.g.:
  - `safeJoin(baseDir, relativePath)` → resolves/realpaths + ensures it stays within `baseDir`
  - `assertNoDotSegments(relativePath)` (or reuse `hasDotSegment`)
- [x] Fix `createImageWithAI`:
  - Validate `targetPath` and each `referenceImages[]` path is inside the version dir.
  - Ensure all file writes go through the shared helper.
- [x] Fix upload endpoint in `backend/src/server.ts`:
  - Resolve/realpath the target directory and compare with the real version dir (use `path.sep` boundary).
  - Consider denying uploads into `.vivd/` and other dot-directories explicitly.
- [x] Fix publishing exposure:
  - Update `PublishService.copyDirectory` to exclude `.vivd/` and dotfiles (or at minimum `.vivd/` + `.git/`).
  - Also add Caddy `file_server` hides in generated config as defense-in-depth.

### Phase 2 — DB correctness (P1)

- [ ] Decide publishing model:
  - Option A: **1 domain per project** → add unique index on `published_site.project_slug`, keep upsert-by-project behavior.
  - Option B: **multiple domains per project** → upsert by `domain` and store multiple rows per project.
- [x] Fix `publishedById` nullability vs FK behavior and generate migration.
- [ ] Add a quick integrity check for `published_site` during startup (warn if inconsistent records exist).

### Phase 3 — Config consistency (P2)

- [x] Standardize env var names for OpenRouter:
  - Canonical: `OPENROUTER_API_KEY`.
  - Align `docker-compose*.yml`, `.env.example`, and `backend/entrypoint.sh`.
- [ ] Make `server.ts` use `getProjectsDir()` (same logic as version utils) for static serving.
- [ ] Align CORS origins with `auth` trusted origins (or document the intended difference).

### Phase 4 — Router decomposition (P1)

- [ ] Split `projectRouter` into modules (no behavior change):
  - `routers/project/generation.ts` (generate/regenerate/status)
  - `routers/project/git.ts` (gitSave/gitHistory/gitLoad/gitDiscard/etc.)
  - `routers/project/publish.ts` (publish/unpublish/list published)
  - `routers/project/maintenance.ts` (migrations/admin maintenance)
- [ ] Split `agentRouter`:
  - session CRUD, session status
  - checklist run/get/fix
  - SSE subscription
- [ ] Split `assetsRouter`:
  - filesystem CRUD/listing
  - AI image operations

### Phase 5 — Shared domain utilities (P1)

- [ ] Extract slug helpers into a single module (used by import + generator context).
- [ ] Add `requireVersionDir(slug, version)` helper (and use everywhere).
- [ ] Add `requireAdmin(ctx)` helper to reduce repeated role checks (if you keep `adminProcedure`, keep it minimal).

### Phase 6 — Observability + Error handling (P2)

- [ ] Standardize errors:
  - Use `TRPCError` codes for 401/403/404/400.
  - Keep consistent error shapes for the frontend.
- [ ] Introduce a small logger wrapper (`debug/info/warn/error`) and reduce noisy `console.log`.

### Phase 7 — Dependency + test hygiene (P2)

- [ ] Confirm `@openrouter/sdk` is unused and remove it if safe.
- [ ] Decide what to do with `backend/test/`:
  - Wire up `mocha` with a minimal “unit-only” set, **without** paid API calls.
  - Or move these scripts into `backend/src/scripts/` and remove the test folder.

## Verification (per phase)

- [ ] Phase 1: manually validate uploads/AI image generation cannot write outside a version dir; published sites do not expose `.vivd/`.
- [ ] Phase 2: run DB migration locally; validate publish/unpublish still works.
- [ ] Phase 3+: run `backend` build (`npm run build`) and boot the stack via compose.

## Open Questions / Decisions

- Publishing model: one domain per project vs multiple domains per project?
- Should “download” export include internal artifacts (for backups) or only the public site?
- Do we want to allow any dotfiles to be served from published sites (e.g. `.well-known/`), or block all dotfiles and add explicit exceptions?
