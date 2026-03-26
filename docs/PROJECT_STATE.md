# Vivd Project State (Current)

> Goal: run Vivd as a reliable multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and predictable publish/preview flows.

## Current Focus

- Finish the OpenCode-aligned Studio chat/runtime refactor and close the remaining upstream-parity gaps.
- Harden Studio lifecycle across Fly and Docker, especially auth, rehydrate/revert, and env drift paths.
- Close the remaining scratch-to-Studio initial-generation gaps and validate the dedicated builder path.
- Continue `docs/refactor-and-hardening-plan.md`, starting with auth, transport/state cleanup, and self-host config/source-of-truth cleanup.
- Keep upstream references in `vendor/` useful and keep this file scoped to active work.

## Current Status

- The control-plane/backend (`packages/backend`) and isolated Studio runtime (`packages/studio`) split is stable.
- Bucket-first source, preview, and publish flow is active.
- Fly studio-machine orchestration covers core lifecycle paths; the Docker provider is available but still needs parity hardening.
- Multi-org auth and tenant host scoping are in place across the core control plane.
- The self-host profile split is far enough along that `solo` is the primary self-host target; `platform` remains supported but lower priority.
- The dedicated builder runtime exists behind `VIVD_ARTIFACT_BUILDER_ENABLED` and is still dark-launched.

## Latest Progress

- 2026-03-26: completed the `@vivd/builder` package surface so editor/package resolution matches the workspace import pattern. The builder workspace already passed `tsc`, but it was still imported as `@vivd/builder` from backend code without exposing a `types`/`exports` surface or emitting declaration files, which could leave IDE package resolution red even while CI passed through local TS path aliases. The package now publishes `dist/index.d.ts` and matching export metadata so both build output and editor resolution line up with how the workspace is consumed.
- 2026-03-26: changed the Studio chat end-of-run diff viewer from a split summary-plus-bottom-preview layout to an inline accordion closer to the OpenCode app review UI. Each changed file now expands in place instead of duplicating itself into a detached detail panel at the bottom, and binary/empty-text diffs now show an explicit "no inline text diff preview" message instead of a confusing blank-looking block.
- 2026-03-26: fixed the first validate/typecheck regression from the new builder workspace and the matching frontend image-build gap. Frontend typecheck intentionally includes backend source, but its TS config had only been taught to resolve `@vivd/shared`, not the new `@vivd/builder` package, so clean CI runs could not resolve backend builder imports and also surfaced two small backend typing issues. Frontend typecheck now resolves builder source directly, the backend builder runtime/request service no longer carries the unused import / implicit-`any` error that showed up in GitHub validate, and the frontend Docker image now copies/installs the builder workspace before `npm run build -w @vivd/frontend` so container builds see the same workspace graph as local builds.
- 2026-03-26: added a non-drag fallback for Studio file moves in `packages/studio/client`. File-tree items now expose a `Move to` context-menu submenu that reuses the existing move mutation, so files and folders can still be moved into off-screen targets when the current drag-and-drop tree cannot auto-scroll far enough to reach them; that target list now also skips noisy build/dependency folders like `dist`, `build`, `node_modules`, `.next`, `.nuxt`, and `.output` while still keeping `.vivd` working folders available. Focused file-tree tests now cover both target filtering and the context-menu move action.

## Active Priorities

1. Execute `docs/refactor-and-hardening-plan.md`, starting with runtime auth hardening, remaining OpenCode chat transport/state cutover work, and self-host config cleanup.
2. Validate Studio lifecycle hardening across Fly and Docker, especially rehydrate/revert behavior and machine/env sync paths.
3. Finish scratch-to-Studio initial-generation hardening and prove the dedicated builder path before moving Astro preview/publish builds off Studio machines.
4. Keep `solo` self-hosting simple while continuing Docker parity, SSE Phase 1, targeted smoke coverage, and removal of remaining local-FS assumptions.
5. Land the next control-plane ops features: reversible project archiving, superadmin project transfer, and post-login tenant redirect.

## Open Decisions

| Question | Status |
|---|---|
| Fly app strategy (single app vs app-per-tenant) | TBD |
| Concurrency model for edits (single-writer lock vs optimistic) | TBD |
| Build execution location (backend vs studio vs dedicated builder) | In progress: dedicated builder image/runtime is scaffolded behind `VIVD_ARTIFACT_BUILDER_ENABLED`, but the switch stays off until the new path is production-verified |
| Preview artifact exposure (public vs signed URLs) | TBD |
| Studio URL pattern (iframe route vs redirect vs subdomain) | TBD |
| Self-hosting boundary (`solo` vs `platform`, and instance/org/project policy split) | In progress in `docs/self-hosting-profile-split-plan.md`; the `solo` foundation is landed, while migration-path docs and the remaining boundary cleanup are still open |

## Archive

- Historical progress entries and trimmed detail are in `docs/PROJECT_STATE_ARCHIVE.md`.
