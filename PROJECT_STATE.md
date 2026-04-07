# Vivd Project State

> Goal: run Vivd as a reliable multi-tenant SaaS with isolated Studio machines, object-storage-backed projects, and predictable preview/publish flows.

## Current Snapshot

- The control-plane/backend (`packages/backend`) and isolated Studio runtime (`packages/studio`) split is stable, and bucket-first source/preview/publish flow is the baseline.
- Fly studio orchestration covers the core hosted lifecycle paths, while Docker/self-host has recent image-reconciliation and runtime-url hardening that now needs repeatable smoke coverage.
- The current architectural reshapes are the Studio preview/runtime split, the OpenCode-aligned chat/runtime refactor, and continued plugin extraction behind generic backend/frontend/CLI contracts.
- Scratch-to-Studio handoff has been hardened significantly, but the remaining work is proving the attach/build path cleanly across local, CI, and hosted flows.
- The dedicated builder runtime exists behind `VIVD_ARTIFACT_BUILDER_ENABLED` and remains dark-launched until the end-to-end path is production-verified.

## Active Priorities

1. Finish the remaining OpenCode-aligned Studio chat/runtime refactor and close the highest-value upstream-parity gaps.
2. Land the Studio preview architecture rework in `docs/studio-preview-architecture-plan.md`, especially the live-preview vs publish-preview split and runtime URL policy.
3. Keep hardening Studio lifecycle across Fly and Docker, especially auth, rehydrate/revert, quiesce, and env/image drift paths.
4. Validate the scratch-to-Studio handoff and dedicated builder path end to end before moving more build responsibility off Studio machines.
5. Continue extracting first-party plugins behind the new generic backend/frontend/CLI boundaries, keeping host compatibility wrappers thin.
6. Keep `solo` self-hosting simple while turning the recent Docker/runtime/reconcile fixes into repeatable validation and release smoke coverage.
7. Keep the next control-plane ops tranche queued: reversible project archiving, superadmin project transfer, and post-login tenant redirect.

## Latest Progress

- 2026-04-07: fixed the frontend-side Analytics package wiring after extracting `packages/plugin-analytics`. The Analytics project page was imported from `@vivd/plugin-analytics`, but `@vivd/frontend` still did not declare that workspace dependency or copy/install/sync it in its Docker dev/build paths, which caused Vite import-resolution failures when opening the Analytics panel. The fix added the frontend workspace dependency, updated `packages/frontend/Dockerfile`, and updated Docker Compose dev watch rules so frontend containers can resolve and live-sync the plugin package.
- 2026-04-07: added live-preview screenshot capture as a first-class backend/CLI capability. The backend now resolves the active Studio runtime plus auth headers and proxies screenshot capture through the scraper service, and the CLI now exposes `vivd preview screenshot [path]`, saving into `.vivd/dropped-images/` by default unless `--output` is passed. Focused backend/CLI/scraper/Studio tests and typechecks are green.
- 2026-04-07: fixed the first plugin-package Docker/runtime regression after extracting Analytics. The backend container had started crashing on boot with `ERR_MODULE_NOT_FOUND: Cannot find package '@vivd/plugin-analytics'`, which surfaced in the frontend as `502 Bad Gateway` plus empty tRPC JSON responses, and the Studio image build had the same root issue while building `@vivd/cli`. The fix was to declare `@vivd/plugin-analytics` as a real dependency of both `@vivd/backend` and `@vivd/cli`, refresh the root lockfile, update `packages/backend/Dockerfile` plus `packages/studio/Dockerfile` so their workspace-aware install/build stages copy the plugin package manifest/source and include the plugin workspace in `npm ci`, and align `packages/backend/tsup.config.ts` / `packages/cli/tsup.config.ts` with that package boundary. Verified with `npm run build -w @vivd/backend`, `npm run build -w @vivd/cli`, `docker compose build backend`, backend container recovery, and `npm run build:studio:local`.
- 2026-04-07: made plugin-owned CLI contributions part of the extracted Analytics package boundary instead of keeping Analytics-specific help, aliases, and formatting in the CLI host. The shared CLI plugin contract now lives in `packages/shared`, `packages/plugin-analytics` owns the Analytics CLI module, and the CLI host resolves plugin-provided help/aliases/renderers while keeping the generic `vivd plugins ...` grammar.

## Open Decisions

| Question | Status |
|---|---|
| Fly app strategy (single app vs app-per-tenant) | Lean single app; if runtime-host masking is needed for platform preview, prefer wildcard hostnames plus Fly-native routing/replay over app-per-tenant sprawl |
| Concurrency model for edits (single-writer lock vs optimistic) | Open; the near-term plan is still to add single-writer Studio edit locking first |
| Build execution location (backend vs studio vs dedicated builder) | In progress: dedicated builder support exists behind `VIVD_ARTIFACT_BUILDER_ENABLED`, but it stays off until the path is production-verified |
| Preview artifact exposure (public vs signed URLs) | Still open |
| Studio URL pattern and Live Preview vs Publish Preview UX | In progress in `docs/studio-preview-architecture-plan.md`; current direction is real runtime origins for Studio/live preview and stable project/version URLs for publish/share preview |
| Self-hosting boundary (`solo` vs `platform`, and instance/org/project policy split) | In progress in `docs/self-hosting-profile-split-plan.md`; `solo` is the default self-host story, with boundary cleanup and migration-path docs still open |
| Headless CMS source of truth + agent surface | Reopened in `docs/file-based-cms-spec.md`; current leaning is file-first, project-owned content with a collections-first v1 |

## Archive

- Historical progress entries and trimmed detail are in `docs/PROJECT_STATE_ARCHIVE.md`.

Last updated: 2026-04-07
