# Vivd Project State (Current)

> Goal: run Vivd as a reliable multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and predictable publish/preview flows.

## Current Focus

- Finish the OpenCode-aligned Studio chat/runtime refactor and close the remaining upstream-parity gaps.
- Harden Studio lifecycle across Fly and Docker, especially auth, rehydrate/revert, and env drift paths.
- Close the remaining scratch-to-Studio initial-generation gaps and validate the dedicated builder path.
- Land the Studio preview architecture rework so live preview stops depending on path-mounted dev-preview rewriting and publish-fidelity is explicit.
- Continue `docs/refactor-and-hardening-plan.md`, starting with auth, transport/state cleanup, and self-host config/source-of-truth cleanup.
- Keep upstream references in `vendor/` useful and keep this file scoped to active work.

## Current Status

- The control-plane/backend (`packages/backend`) and isolated Studio runtime (`packages/studio`) split is stable, and bucket-first source/preview/publish flow is active.
- Fly studio-machine orchestration covers the core hosted lifecycle paths; Docker/self-host parity improved substantially in this cycle, but image reconciliation still lags Fly.
- Multi-org auth and tenant host scoping are in place across the core control plane, while public self-host/install docs continue to center the `solo` profile.
- The dedicated builder runtime exists behind `VIVD_ARTIFACT_BUILDER_ENABLED` and is still dark-launched.

## Latest Progress

- 2026-03-30: fixed the clean-CI frontend regression where `EmbeddedStudio.test.tsx` could not resolve `@vivd/shared/types` through Vite/Vitest. `packages/frontend` had TypeScript path mappings for `@vivd/shared`, but its Vite and Vitest configs only aliased `@`, so workspace-source imports depended on `@vivd/shared` having already been built. Frontend Vite/Vitest now alias `@vivd/shared` exactly plus its subpaths to `packages/shared/src`, and the targeted frontend regression suite plus frontend typecheck are green again.
- 2026-03-30: fixed the lingering Studio client typecheck failure in `client/src/features/opencodeChat/provider.test.tsx`. The hoisted bootstrap mock had been inferred with `sessions: never[]`, so later test setup that assigned concrete session rows failed TypeScript even though the provider/runtime code was fine. The test now types that bootstrap fixture explicitly as `OpenCodeChatBootstrap`, and full `npm run typecheck -w @vivd/studio` is green again.

## Active Priorities

1. Execute `docs/refactor-and-hardening-plan.md`, focusing next on the remaining OpenCode chat transport/state cutover work, preview-policy cleanup, and self-host config cleanup.
2. Finish landing the Studio preview architecture rework in `docs/studio-preview-architecture-plan.md`, focusing on the runtime URL strategy, the project-page publish-preview vs Studio live-preview split, and preview bridge rollout.
3. Defer, but keep explicitly queued, the Fly runtime-host masking follow-up for Studio live preview: move platform runtimes from public `host:port` URLs to wildcard hostnames on a single Fly app, likely using Fly-native host routing/replay rather than multiple Fly apps or a Caddy front proxy.
4. Validate Studio lifecycle hardening across Fly and Docker, especially rehydrate/revert behavior and machine/env sync paths.
5. Finish scratch-to-Studio initial-generation hardening and prove the dedicated builder path before moving Astro preview/publish builds off Studio machines.
6. Keep `solo` self-hosting simple while continuing Docker parity, SSE Phase 1, targeted smoke coverage, and removal of remaining local-FS assumptions.
7. Refactor the Studio runtime session contract so backend/provider code returns an explicit browser-safe Studio URL (for example `browserUrl`) alongside direct runtime/compatibility origins. That should replace the current frontend heuristics in `useStudioHostRuntime` and move TLS/topology/provider decisions back to the layer that actually knows the deployment shape.
8. Add real Docker Studio image reconciliation parity with Fly: track the resolved image/digest for running Docker runtimes, detect tag/content drift (including rebuilt local tags such as `vivd-studio:local`), and provide a reliable reconcile/recreate path so self-host/local Docker does not silently keep serving stale Studio images.
9. Land the next control-plane ops features: reversible project archiving, superadmin project transfer, and post-login tenant redirect.
10. Add Studio edit locking so only one person can actively edit a Studio workspace at a time, and use that work to settle the broader edit-concurrency model.

## Open Decisions

| Question | Status |
|---|---|
| Fly app strategy (single app vs app-per-tenant) | Lean single app; if we add runtime-host masking for platform preview, prefer wildcard hostnames plus Fly-native routing/replay over app-per-tenant or app-per-runtime sprawl |
| Concurrency model for edits (single-writer lock vs optimistic) | Open; near-term plan is to add single-writer Studio edit locking so only one active editor can hold the workspace while we validate whether broader optimistic collaboration is still needed |
| Build execution location (backend vs studio vs dedicated builder) | In progress: dedicated builder image/runtime is scaffolded behind `VIVD_ARTIFACT_BUILDER_ENABLED`, but the switch stays off until the new path is production-verified |
| Preview artifact exposure (public vs signed URLs) | TBD |
| Studio URL pattern (path-mounted route vs real runtime origin, and how Live Preview vs Publish Preview split in product UX) | In progress in `docs/studio-preview-architecture-plan.md`; current recommendation is real runtime origins for Studio/live preview, stable project/version URLs for shareable preview, and a context-sensitive UX where project pages show Publish Preview while Studio always opens on Live Preview |
| Self-hosting boundary (`solo` vs `platform`, and instance/org/project policy split) | In progress in `docs/self-hosting-profile-split-plan.md`; the `solo` foundation is landed, while migration-path docs and the remaining boundary cleanup are still open |
| Headless CMS source of truth + agent surface | CLI-first plan in `docs/headless-cms-agent-plan.md`; current leaning is control-plane-owned structured content, a Studio-machine `vivd` CLI as the primary agent surface, host-app embedded CMS pages inside Studio, and generated preview/publish content snapshots |

## Archive

- Historical progress entries and trimmed detail are in `docs/PROJECT_STATE_ARCHIVE.md`.
