# Host Smoke

Use this playbook for local Docker/self-host Studio bootstrap, scratch-to-Studio initial generation handoff, embedded iframe readiness, and tenant-host reopen problems.

## What The Host Smoke Proves

`scripts/studio-docker-host-smoke.mjs` is not “boot initial generation, then boot a second Studio”.

It proves three separate contracts:

1. Control-plane bootstrap:
   - create the scratch project
   - open the Studio iframe on the control-plane host
   - observe initial generation and stop it after enough real activity
2. Same-runtime usability after stopping:
   - re-acquire the same iframe
   - type a follow-up draft without sending it
3. Tenant-host reopen:
   - open a second browser page on the tenant host
   - navigate to plain `?view=studio&version=1`
   - confirm the same project/runtime reopens correctly there

That tenant reopen step protects cross-host auth/bootstrap/routing regressions that will not show up if you only test the original control-plane page.

## Failure Signatures

### Real session cutoff

Treat this as a real product/runtime issue:

- `recordedActions=0` or `1`
- `sessionStatus=idle`
- the composer/send button is back
- the assistant emitted only a tiny first batch or an empty shell

This means the run really went idle too early.

### Still-busy run timed out

Treat this as a harness/timing issue first:

- `recordedActions > 0`
- `sessionStatus=busy` or `retry`
- stop button still visible
- the run later continues in logs or in the container

That is not a killed session. Keep the smoke strict for idle or ended runs, but it is acceptable for the harness to stop and continue after one recorded action when the run is still visibly active and the stop button is available.

If `recordedActions=0` but the UI is clearly still active, do not jump straight to a product conclusion either. In April 2026 the smoke also hit a false-negative shape where the stop button, session-history activity indicator, and busy status all showed a live run, but the bootstrap snapshot had not yet exposed countable assistant parts. Treat that as "active but not yet persisted enough for the smoke counter" and give it bounded extra settle time before calling it a real failure.

### Tenant reopen stuck on “Starting studio”

Common clues:

- no interactive iframe on the tenant page
- `preview-bridge.js` 404 or MIME errors in console
- prefixed runtime paths like `/_studio/...`

That usually points at a mounted-path/bootstrap/preview issue, not an OpenCode session failure.

### `locator.fill` timeout right after `initial_generation_settled`

Suspect an iframe reload or remount. Re-acquire the interactive Studio iframe after settle before typing.

### `503 Dev server is starting...`

Do not equate preview/dev-server `503` with “the agent died”. The OpenCode session can still be busy while preview is booting.

### `/undefined?batch=1`

Treat this as a harness bug first. On April 9, 2026, in-frame fetches against runtime tRPC produced bogus `/undefined?batch=1` traffic. The fix was to query runtime tRPC through Playwright's request context instead.

## High-Signal Commands

### Real smoke runs

- Strict real smoke:
  - `STUDIO_IMAGE=vivd-studio:local npm run studio:host-smoke`
- Use a different local port if `18080` is busy:
  - `VIVD_STUDIO_HOST_SMOKE_PORT=18096 STUDIO_IMAGE=vivd-studio:local npm run studio:host-smoke`
- Pause on failure so you can inspect the live compose stack:
  - `VIVD_STUDIO_HOST_SMOKE_PAUSE_ON_FAILURE=1 STUDIO_IMAGE=vivd-studio:local npm run studio:host-smoke`
- Override the smoke model explicitly when model/provider behavior is in question:
  - `VIVD_STUDIO_HOST_SMOKE_MODEL=<model> STUDIO_IMAGE=vivd-studio:local npm run studio:host-smoke`

### Ad-hoc quick repro only

- `VIVD_STUDIO_HOST_SMOKE_MIN_RECORDED_ACTIONS=1`

Use this only for local exploratory repro speed. The repo default remains `2`; the harness has a narrower built-in fallback that accepts one recorded action only when the session is still active and stoppable.

## Live Container Inspection

When the smoke is paused or a failing stack is still up, inspect the Studio container directly.

- Find the relevant containers:
  - `docker ps --format '{{.ID}}\t{{.Names}}\t{{.Ports}}' | rg 'vivd-host-smoke|studio-smoke|18080'`
- Read the runtime-side initial-generation manifest:
  - `docker exec <studio-container> cat /home/studio/project/.vivd/initial-generation.json`
- Check OpenCode session status inside the runtime:
  - `docker exec <studio-container> sh -lc 'node -e "fetch(\"http://127.0.0.1:4096/session/status?directory=/home/studio/project\").then(async (r)=>{console.log(await r.text())})"'`
- Read OpenCode messages for a specific session:
  - `docker exec <studio-container> sh -lc 'node -e "fetch(\"http://127.0.0.1:4096/session/<session-id>/message\").then(async (r)=>{console.log(await r.text())})"'`

Those checks answer “did the agent really stop?” much faster than guessing from the UI alone.

## Focused Protecting Tests

- `npm run test:run -w @vivd/studio -- server/http/previewBridge.test.ts server/httpRoutes/runtime.test.ts`
- `npm run test:run -w @vivd/frontend -- src/pages/EmbeddedStudio.test.tsx src/pages/scratch-wizard/ScratchWizardContext.test.tsx`
- `npm run typecheck -w @vivd/studio`
- `npm run typecheck -w @vivd/frontend`
- `npm run build:studio:local`
- `STUDIO_IMAGE=vivd-studio:local npm run studio:host-smoke`
