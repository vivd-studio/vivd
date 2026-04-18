---
name: testing
description: Use when deciding how to validate a Vivd change, choosing the highest-signal tests for backend/frontend/studio/self-host/Fly work, or debugging why local, CI, release-smoke, or production-shaped verification is failing.
---

# Testing

Use this skill when a change needs validation, when a failure only appears in CI or release smokes, or when you need to decide which tests are worth running in this repo.

## Quick Workflow

1. Start with the smallest proof that matches the change:
   - targeted `vitest` file(s) for one module or behavior
   - package `typecheck` for the touched workspace
   - only then broader package or root checks if the change crosses boundaries
2. Prefer the repo's critical regressions over blanket suites. A smaller set of tests protects most real product risk.
3. If the change touches Fly, Docker, self-host, or release behavior, escalate to the relevant smoke or integration path early instead of assuming unit tests are enough.
4. Keep the real contract strict. Do not weaken behavior checks like `suspended`, wake thresholds, auth invariants, or routing expectations just to get green.
5. Use `scripts/ci-local.sh`, `scripts/publish.sh`, and the relevant workflow or smoke script as the source of truth when local assumptions and CI behavior disagree.

## Fast Test Ladder

- Repo-wide typecheck: `npm run typecheck`
- Common unit and regression baseline: `npm run test:run`
- Studio-only tests: `npm run test:run -w @vivd/studio`
- Backend unit-only: `npm run test:unit -w @vivd/backend`
- Backend integration entrypoint: `npm run test:integration -w @vivd/backend -- <test-file>`
- Local CI wrapper: `npm run ci:local`

During multi-file work, prefer repeating package-level `typecheck` and a few targeted files instead of waiting until the end for a full repo sweep.

## Highest-Signal Checks

- Studio runtime, auth, and cleanup regressions:
  - `npm run test:run -w @vivd/studio -- server/http/studioAuth.test.ts server/httpRoutes/runtime.test.ts client/src/components/chat/ChatContext.followup.test.tsx`
- Studio OpenCode persistence and revert regressions:
  - `npm run test:run -w @vivd/studio -- server/opencode/useEvents.test.ts server/opencode/index.sessions.test.ts server/opencode/runTask.bucketSync.test.ts`
  - `STUDIO_IMAGE=vivd-studio:local npm run studio:image:revert-smoke`
- Backend Studio runtime auth and machine drift regressions:
  - `npm run test:run -w @vivd/backend -- studio_api_router.test.ts trpc_context_org_procedure.test.ts fly_lifecycle.test.ts fly_provider_reconcile.test.ts fly_provider_orchestration.test.ts docker_provider.test.ts local_provider_orchestration.test.ts`
- Frontend embedded or hosted Studio regressions:
  - `npm run test:run -w @vivd/frontend -- src/app/router/guards.test.tsx src/hooks/useStudioHostRuntime.test.ts src/pages/EmbeddedStudio.test.tsx`
- Local Docker or self-host browser smoke:
  - `STUDIO_IMAGE=vivd-studio:local npm run studio:host-smoke`
- Release-tag local preflight:
  - `npm run publish:tag -- --dry-run <version>`

## Env-Gated Integration Tests

Some of the most valuable tests only run when the required infra env is present.

- DB-backed backend integration:
  - requires `DATABASE_URL`
  - enable path: `VIVD_RUN_DB_INTEGRATION_TESTS=1`
  - common entry: `npm run test:integration -w @vivd/backend -- test/integration/db_usage_plugin_services.test.ts`
- Bucket or object-storage integration:
  - requires `VIVD_S3_BUCKET` or `R2_BUCKET`
  - enable path: `VIVD_RUN_ARTIFACT_SYNC_BUCKET_TESTS=1`
  - common entry: `npm run test:run -w @vivd/studio -- server/services/sync/ArtifactSyncService.integration.test.ts`
- Fly integration:
  - requires `FLY_API_TOKEN` and `FLY_STUDIO_APP`
  - critical files:
    - `test/integration/fly_reconcile_flow.test.ts`
    - `test/integration/fly_warm_wake_auth.test.ts`
    - `test/integration/fly_shutdown_bucket_sync.test.ts`
    - `test/integration/fly_opencode_rehydrate_revert.test.ts`

Use `scripts/ci-local.sh` when you want the repo's supported combinations instead of hand-assembling env flags.

## Release And Smoke Surfaces

- Shared CI gate: `.github/workflows/reusable-validate.yml`
- Release preflight: `scripts/publish.sh`
- Image or browser smokes:
  - `scripts/studio-image-smoke.mjs`
  - `scripts/studio-image-revert-smoke.mjs`
  - `scripts/studio-docker-host-smoke.mjs`
  - `scripts/backend-image-smoke.mjs`
  - `scripts/scraper-image-smoke.mjs`

When a change affects startup, publish, Studio machine lifecycle, or self-host behavior, read the relevant script before changing tests. Those scripts often encode the real product contract more accurately than a quick assumption.

## Failure Lens

When a test fails, classify the failure before changing product code:

- product behavior
- harness timing or missing cleanup
- wrong image or wrong env surface
- infra capacity or provider rate limiting

## References

- Read [references/test-surfaces.md](references/test-surfaces.md) for the longer map of test commands, dependencies, and recurring failure patterns.
- Read `.agents/skills/fly-studio-machines/SKILL.md` as a companion when the testing problem is specifically about Fly machine wake, reconcile, or auth behavior.
- Read `.agents/skills/studio-runtime-debugging/SKILL.md` as a companion when the testing problem is specifically about Studio runtime bootstrap, host smoke, OpenCode-backed persistence, rehydrate, or revert behavior.
