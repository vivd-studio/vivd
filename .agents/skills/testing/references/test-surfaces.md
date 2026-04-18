# Vivd Test Surfaces

This note is the longer companion to the `testing` skill. Use it when you need more than the quick workflow in `SKILL.md`.

## Repo Reality

- This monorepo uses npm workspaces with one root lockfile.
- Most test execution is `vitest`.
- The highest-value non-unit validation comes from environment-gated integration tests and smoke scripts.
- The repo explicitly prefers meaningful, targeted tests over chasing coverage numbers.
- Full suites are not the default path. They can be slow, infra-dependent, or expensive.

## Main Commands

- Root:
  - `npm run typecheck`
  - `npm run test:run`
  - `npm run test:integration -- <backend-test-file>`
  - `npm run studio:host-smoke`
  - `npm run studio:image:revert-smoke`
  - `npm run ci:local`
- Backend:
  - `npm run test:run -w @vivd/backend -- <files>`
  - `npm run test:unit -w @vivd/backend`
  - `npm run test:integration -w @vivd/backend -- <files>`
- Frontend:
  - `npm run test:run -w @vivd/frontend -- <files>`
- Studio:
  - `npm run test:run -w @vivd/studio -- <files>`
  - `npm run typecheck -w @vivd/studio`
- Scraper:
  - `npm run test:run -w @vivd/scraper -- <files>`

## What Depends On What

- Plain unit/regression tests:
  - usually only need the normal workspace install
- DB integration:
  - needs `DATABASE_URL`
  - uses `VIVD_RUN_DB_INTEGRATION_TESTS=1`
- Bucket/object-storage integration:
  - needs `VIVD_S3_BUCKET` or `R2_BUCKET`
  - uses `VIVD_RUN_ARTIFACT_SYNC_BUCKET_TESTS=1`
- Fly integration:
  - needs `FLY_API_TOKEN`
  - needs `FLY_STUDIO_APP`
  - often benefits from `VIVD_FLY_TEST_DRIFT_IMAGE`
  - some paths also need model/provider env, depending on what the runtime is expected to do
- Browser/self-host smokes:
  - need Docker
  - usually need Playwright Chromium installed
  - may need model credentials such as `OPENROUTER_API_KEY` when the smoke is configured to use an OpenRouter model

## The Tests That Matter Most

These keep showing up in CI, release gating, or project-state entries because they guard real product risk:

- Backend auth/context/runtime invariants:
  - `packages/backend/test/studio_api_router.test.ts`
  - `packages/backend/test/trpc_context_org_procedure.test.ts`
- Fly lifecycle/reconcile/orchestration:
  - `packages/backend/test/fly_lifecycle.test.ts`
  - `packages/backend/test/fly_provider_reconcile.test.ts`
  - `packages/backend/test/fly_provider_orchestration.test.ts`
- Docker/local Studio machine orchestration:
  - `packages/backend/test/docker_provider.test.ts`
  - `packages/backend/test/local_provider_orchestration.test.ts`
- Studio runtime HTTP/auth/cleanup:
  - `packages/studio/server/http/studioAuth.test.ts`
  - `packages/studio/server/httpRoutes/runtime.test.ts`
  - `packages/studio/server/httpRoutes/client.test.ts`
  - `packages/studio/server/services/runtime/RuntimeQuiesceCoordinator.test.ts`
- Frontend embedded Studio/routing:
  - `packages/frontend/src/pages/EmbeddedStudio.test.tsx`
  - `packages/frontend/src/hooks/useStudioHostRuntime.test.ts`
  - `packages/frontend/src/app/router/guards.test.tsx`
- Real integration/smoke paths:
  - `packages/backend/test/integration/fly_reconcile_flow.test.ts`
  - `packages/backend/test/integration/fly_warm_wake_auth.test.ts`
  - `packages/backend/test/integration/fly_shutdown_bucket_sync.test.ts`
  - `packages/backend/test/integration/fly_opencode_rehydrate_revert.test.ts`
  - `packages/studio/server/services/sync/ArtifactSyncService.integration.test.ts`
  - `scripts/studio-docker-host-smoke.mjs`
  - `scripts/studio-image-smoke.mjs`
  - `scripts/studio-image-revert-smoke.mjs`

## Common Testing Challenges

### Fly

- Distinguishing suspend/resume from cold boot
- Runtime cleanup not happening before park/reconcile
- API polling rate limits
- Test machines left behind from previous runs
- Drift baselines pointing at missing or bad images
- Release image behavior differing from local code expectations

When these tests fail, check whether the failure is:

- product behavior
- harness timing
- infra capacity/rate limiting
- wrong image or wrong env surface

### Docker And Self-Host

- Bugs often show up only after full startup and browser interaction
- Runtime-origin/path routing can fail even when unit tests are green
- Local host smokes can be affected by the local Caddy dev proxy or port ownership
- Same-tag image refreshes and image reconciliation need behavior checks, not only config checks

### Studio / OpenCode

- Startup races around initial generation or session bootstrap
- Event-stream staleness and visibility-driven reconnect behavior
- Rehydrate/revert flows that need real runtime state, not only helper-unit assertions
- Flaky-looking failures that are actually missing waits, cleanup, or workspace hydration in the harness

### CI / Workspace Setup

- Clean CI can expose alias-resolution gaps that local incremental builds hide
- Some tests accidentally rely on already-built workspace packages unless configs are kept honest
- Release validation may test the built image artifact rather than the source tree you just inspected

## Practical Test Selection

If you changed one helper or isolated module:

- run the specific test file
- run package `typecheck`

If you changed backend runtime/machine/auth behavior:

- run the targeted backend test file(s)
- run the backend runtime regression set
- escalate to Fly or host smoke if behavior is lifecycle-sensitive

If you changed Studio runtime/server behavior:

- run the specific Studio file(s)
- run `server/http/studioAuth.test.ts` and `server/httpRoutes/runtime.test.ts`
- escalate to Studio image or host smoke if startup or runtime cleanup changed

If you changed frontend embedded Studio or preview routing:

- run the targeted frontend tests
- run `EmbeddedStudio.test.tsx`, `useStudioHostRuntime.test.ts`, and relevant route/guard coverage
- escalate to the browser host smoke if the bug involved real iframe/runtime interaction

If you changed release, self-host, or image behavior:

- read `scripts/publish.sh`
- read the relevant smoke script
- run the smallest local smoke that still exercises the changed contract

## Deployed Testing Servers And SSH

Sometimes the fastest path is to inspect the real testing deployment on its VPS host. That can be appropriate for:

- self-host update failures
- image/tag drift
- service startup mismatches
- Caddy/backend/studio container state
- logs that are only visible on the host

Guardrails:

- only do this when the user has explicitly provided or confirmed access details
- keep repo docs generic; do not record raw IPs, usernames, or private hostnames here
- prefer describing the workflow, not the secret coordinates
- for Fly-backed prod debugging, prefer read-only `flyctl` inspection first when the local environment already exposes the needed token
- if host-level logs are needed, ask the user for the host IP or SSH access details explicitly

Typical SSH-assisted checks:

- confirm which image tags are actually configured and running
- inspect recent logs for backend, Studio, Caddy, and database-adjacent failures
- inspect container/service status and restart loops
- compare reported app version with the version the UI thinks is pending/current
- verify env or compose drift when a local fix did not actually land on the server

For local Docker or self-host failures, prefer finding the still-running Studio or related containers and reading `docker logs` / `docker exec` output before guessing from the UI alone.

## Where The Truth Usually Lives

- `scripts/ci-local.sh` for supported local validation combinations
- `scripts/publish.sh` for release preflight expectations
- `.github/workflows/reusable-validate.yml` for the shared CI regression set
- `.github/workflows/publish.yml` for release smoke expectations
- `PROJECT_STATE.md` for current testing pain points and recently proven regressions
- `PROJECT_STATE_ARCHIVE.md` for older but still useful failure patterns
