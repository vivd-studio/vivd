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
- 2026-04-11: finished the remaining Contact Form runtime extraction and cleaned the last backend coupling out of the extracted plugin packages. `@vivd/plugin-contact-form` now owns the submit, feedback, turnstile, retention, source-host, and admin-hook runtime logic behind injected ports, while backend host wrappers only bind concrete deps. The backend also gained a registry-free plugin instance store so Analytics and Contact Form backend contributions no longer create a load-order cycle through `registry -> descriptors -> backendContribution -> instanceService -> registry`. Focused validation is green for `npm run typecheck -w @vivd/plugin-contact-form`, `npm run typecheck -w @vivd/backend`, and `npm run test:run -w @vivd/backend -- test/contact_form_recipient_verification_service.test.ts test/contact_submission_retention_service.test.ts test/email_feedback_router.test.ts test/project_plugin_service.test.ts test/plugins_generic_router.test.ts test/public_api.test.ts test/superadmin_router.test.ts`. A residue scan confirms there are no remaining `@vivd/backend/src` imports in `packages/plugin-contact-form` or `packages/plugin-analytics`; the remaining backend cleanup is now second-wave host genericization work, mainly plugin-specific monthly-usage counting in `PluginEntitlementService`, contact-form-only organization summaries in `trpcRouters/organization.ts`, the analytics-only summary escape hatch in `ProjectPluginService`, and a few control-plane-only Contact Form surfaces such as feedback endpoint exposure and the verification-route alias.
- 2026-04-11: landed the first constrained Astro model-editing path in Studio instead of leaving `src/content.config.ts` as source-open-only. The Astro adapter now preserves reference target metadata, `@vivd/shared/cms` can rewrite the supported `defineCollection({ schema: ... })` subset back into `src/content.config.ts`, and Studio CMS now exposes a structured `Model` editor tab that saves supported field-tree edits through the new `cms.updateModel` mutation rather than forcing raw source edits for every schema change. This path intentionally rewrites only the target collection schema block and still treats custom TypeScript patterns as source-edit territory. The next CMS follow-up is preview persistence resolution: in-page text edits and image drops for Astro CMS-backed pages still need to resolve back into owning entry fields before falling back to raw patching. Focused validation is green for `npm run typecheck -w @vivd/shared`, `npm run typecheck -w @vivd/studio`, `npm run test:run -w @vivd/studio -- server/trpcRouters/cms.router.test.ts`, and `npm run test:run -w @vivd/cli -- src/cms.test.ts`.
- 2026-04-11: trimmed the root `docs/` set by moving clearly superseded or historical planning material into `docs/old/`. The archive pass moved the old DB-first CMS direction (`docs/old/headless-cms-agent-plan.md`), the implemented Phase-1 entitlements rollout plan (`docs/old/plugin-entitlements-mvp.md`), the one-off refactor checklist (`docs/old/refactoring-day-checklist.md`), the stale configurable-models plan (`docs/old/configurable-ai-models-plan.md`), and the older `vivd.studio` homepage draft (`docs/old/vivd-studio-homepage-middle-ground.md`) out of the active docs root so the remaining top-level docs stay focused on current architecture and queued work.

## Open Decisions

| Question | Status |
|---|---|
| Fly app strategy (single app vs app-per-tenant) | Lean single app; if runtime-host masking is needed for platform preview, prefer wildcard hostnames plus Fly-native routing/replay over app-per-tenant sprawl |
| Concurrency model for edits (single-writer lock vs optimistic) | Open; the near-term plan is still to add single-writer Studio edit locking first |
| Build execution location (backend vs studio vs dedicated builder) | In progress: dedicated builder support exists behind `VIVD_ARTIFACT_BUILDER_ENABLED`, but it stays off until the path is production-verified |
| Preview artifact exposure (public vs signed URLs) | Still open |
| Studio URL pattern and Live Preview vs Publish Preview UX | In progress in `docs/studio-preview-architecture-plan.md`; current direction is real runtime origins for Studio/live preview and stable project/version URLs for publish/share preview |
| Self-hosting boundary (`solo` vs `platform`, and instance/org/project policy split) | In progress in `docs/self-hosting-profile-split-plan.md`; `solo` is the default self-host story, with boundary cleanup and migration-path docs still open |
| Headless CMS source of truth + agent surface | In progress in `docs/astro-content-collections-plan.md`. Astro-backed projects now read `src/content.config.ts` plus real Astro entry files as the only supported structured-content source of truth, Studio renders those supported schemas back through the existing structured CMS form via the `astro-collections` adapter, Astro entry editing/reordering/creation now write real collection files directly, and Studio now also exposes constrained model editing that rewrites the supported collection `schema` block back into `src/content.config.ts`. The remaining work is broader entry-pattern support polish plus preview text/image persistence resolving back into CMS entry fields instead of falling through to raw patching by default. |

## Archive

- Historical progress entries and trimmed detail are in `docs/PROJECT_STATE_ARCHIVE.md`.
- Superseded or one-off planning docs that should not stay in the active root live under `docs/old/`.

Last updated: 2026-04-11
