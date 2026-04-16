# Vivd Project State

> Goal: ship Vivd as a reliable hosted website builder first. Keep self-host and open-core as deferred options, not current product drivers.

## Current Snapshot

- Hosted `platform` mode is the product focus; `solo` stays internal or experimental.
- The backend/control-plane, Studio runtime, and plugin package boundaries are established enough for product work; current cleanup is about simplification, not another boundary rewrite.
- Preview and publish still run through the existing Studio/local build path while preview architecture and Studio lifecycle hardening continue.
- Scratch-to-Studio handoff is much better, but still needs repeatable attach/build validation across local, CI, and hosted flows.

## Active Priorities

1. Finish the platform-first cleanup in `plans/platform-first-stabilization-plan.md`.
2. Land the preview/runtime split in `plans/studio-preview-architecture-plan.md`.
3. Close the highest-value OpenCode-aligned Studio chat/runtime gaps.
4. Harden Studio lifecycle across Fly and Docker, especially auth, rehydrate/revert, quiesce, and env/image drift.
5. Keep plugin extraction moving behind generic host contracts without leaking host policy into plugin contracts.

## Backlog / To-Do

- [ ] Break the next control-plane ops tranche into implementation-ready slices: reversible project archiving, superadmin project transfer, and post-login tenant redirect.
- [ ] Prove the scratch-to-Studio attach/build handoff end to end with repeatable smoke coverage.
- [ ] Define the next lightweight GitHub integration slice so linked personal accounts and user-chosen repository URLs share one repo-binding model.
- [ ] Decide the next follow-up after the current preview architecture work lands for preview artifact exposure and Studio URL policy.

## Latest Progress

Keep entries short: one sentence on the change, plus a brief validation note when it matters.

- 2026-04-17: Fixed the `publish.sh`-blocking Fly provider typecheck by exposing the suspend-fallback diagnostic accessor that the prod-shaped reconcile smoke already reads via `any`. Validation: `npm run typecheck -w @vivd/backend` and `npm run typecheck -w @vivd/frontend` both pass.
- 2026-04-17: Polished the Table Booking calendar/setup pass with quieter day-cell copy, clearer open/override states, a sticky selected-day context panel on larger screens, and a 2x3 weekly-hours editor layout that fixes the obvious cramped-field malformation in setup. Focused validation is green for `npm run test:run -w @vivd/frontend -- src/plugins/table-booking/TableBookingProjectPage.test.tsx`, `npm run typecheck -w @vivd/plugin-table-booking`, and `npx vite build` from `packages/frontend`.
- 2026-04-17: Frontend Tailwind scanning now includes plugin workspaces, which fixed missing utility classes on plugin-owned pages such as the Table Booking calendar view. Validation: `npm run build -w @vivd/frontend` queued.
- 2026-04-17: Platform-first mode flags now flow through backend and frontend config, reducing raw `solo` checks and making self-host/admin surface visibility explicit. Focused backend/frontend tests passed; package-level `typecheck` is still blocked by unrelated in-flight workspace issues.
- 2026-04-17: The first `external_embed` provider path is live via a curated Google Maps plugin under `plugins/external/google-maps`, with backend host-managed `ensure/info/updateConfig` behavior and generic project-page config/snippet rendering instead of a native backend module. Focused validation is green for `npm install --ignore-scripts`, `npm run generate -w @vivd/installed-plugins`, `npm run typecheck -w @vivd/plugin-sdk`, `npm run typecheck -w @vivd/plugin-google-maps`, `npm run typecheck -w @vivd/backend`, `npm run typecheck -w @vivd/studio`, `npm run test:run -w @vivd/backend -- test/external_embed_plugin_service.test.ts test/plugins_generic_router.test.ts`, `npm run test:run -w @vivd/backend -- test/organization_router.test.ts test/superadmin_router.test.ts`, `npm run test:run -w @vivd/frontend -- src/pages/ProjectPlugins.test.tsx src/plugins/shortcuts.test.ts`, and `npm run test:run -w @vivd/studio -- client/src/plugins/shortcuts.test.ts`; frontend and installed-plugin typecheck remain blocked by unrelated in-flight `table-booking` frontend work in this tree.
- 2026-04-17: Fixed the first Google Maps activation follow-up by adding a new entitlement migration for `google_maps`, applying it successfully to the local dev DB, and renaming the project plugin bucket from `Needs attention` to `Not active` so disabled/suspended policy state reads as status instead of a breakage signal. Focused validation is green for `npm run test:run -w @vivd/frontend -- src/pages/ProjectPlugins.test.tsx`, `npm run test:run -w @vivd/backend -- test/superadmin_router.test.ts test/organization_router.test.ts test/install_profile_service.test.ts`, and `DATABASE_URL='postgresql://postgres:password@localhost:5432/vivd' npm run db:migrate -w @vivd/backend`.

## Archive

- Older progress entries and trimmed detail live in `PROJECT_STATE_ARCHIVE.md`.
- Superseded or historical plans live under `plans/old/`.

Last updated: 2026-04-17
