# Fly Suspend Investigation Plan

> Goal: explain why the real Fly suspend/reconcile smokes are consistently falling back to `stopped` from this machine while recent production behavior shows many machines still parking as `suspended`, then keep only the hardening that is justified by evidence.

## Working Assumptions

- `v1.1.92` is still the latest known state where the relevant tests reliably observed `suspended`.
- We are treating `v1.1.92` as the accepted known-good control unless later evidence forces a re-run.
- As of April 9, 2026, the current `1.1.100` picture is worse than the earlier `1.1.99` screenshot: the visible `vivd-studio-prod` machines are now `stopped` or `started`, and at least one active `1.1.100` machine (`e2869e7dcd29d8`) has already gone through a real `stop -> start` cycle after rollout.
- The current local test shape may still be pessimistic relative to production, especially around machine size, timing, and machine history.
- We should avoid keeping broad suspend-specific hardening if production evidence and focused experiments show that part of it is unnecessary.

## Checklist

### 1. Re-establish the test matrix

- [x] Re-run `fly_warm_wake_auth.test.ts` with a more production-like suspend-eligible config.
- [x] Re-run `fly_reconcile_flow.test.ts` with the same config.
- [x] Compare `shared/1024`, `shared/2048`, and the closest safe production-like test shape that Fly suspend still supports.
- [ ] Use `v1.1.92` as the known-good control without re-running it unless later evidence makes that necessary.

### 2. Compare tests against production reality

- [x] List current production Studio machines after the latest deploy/reconcile pass.
- [x] Bucket them by final parked state: `suspended`, `stopped`, `started`, other.
- [x] Identify a small set of stopped outliers and a matching set of healthy suspended machines for comparison.
- [x] Capture the concrete machine ids, image tags, guest shape, region, and most recent relevant events for both groups.

### 3. Investigate stopped outliers

- [ ] Check whether the stopped outliers already predate the latest image/update.
- [ ] Compare env, metadata, access-token drift markers, and service config against healthy suspended machines.
- [ ] Check whether the outliers correlate with specific runtime conditions:
- [ ] active OpenCode sessions
- [ ] dev server state
- [ ] sync or hydration activity
- [ ] older drifted images or replaced machines
- [ ] If possible, inspect one stopped outlier close to failure time instead of only using post-destroy test machines.

### 4. Investigate possible test-harness skew

- [x] Review whether the smokes still generate extra traffic or timing pressure that production does not.
- [ ] Check whether the reconcile smoke parks the drifted machine too soon after startup relative to production.
- [x] Check whether warm-wake auth is still holding runtime/browser/session activity longer than the real product path.
- [x] Decide whether any harness timing changes are warranted without weakening the real `suspended` contract.
- [x] Check whether the GitHub workflow guest shape matches production.
- [x] Add a production-shaped smoke that starts from a non-running drifted machine instead of asserting suspend on a just-created machine.

### 5. Review current hardening for cleanup candidates

- [ ] Inventory the suspend-focused code changes made during this investigation.
- [ ] Mark each change as one of:
- [ ] keep because it fixes a proven product issue
- [ ] keep because it is cheap and low-risk
- [ ] remove or simplify because evidence does not support it
- [ ] If production evidence shows the issue is narrower than the local tests suggested, do a cleanup pass before merging.

### 6. Document the final learning

- [x] Update `.agents/skills/fly-studio-machines/SKILL.md` with the confirmed lessons.
- [x] Add the final outcome to `PROJECT_STATE.md`.
- [x] Summarize which signals distinguish a real Fly/platform suspend fallback from a Vivd test/runtime issue.

## Evidence Log

### Confirmed so far

- The current local Fly smokes still fail on `expected 'stopped' to be 'suspended'` even after runtime cleanup hardening.
- A fresh dev tag from this machine, `dev-20260409-154229-suspendhardening`, still reproduced the failure on real Fly.
- The failure still occurs on `shared / 1024 MB`, which should be suspend-compatible.
- The failure also still occurs on `shared / 2048 MB`, so simply moving the local smoke from 1 GiB to 2 GiB did not fix the current-image run.
- The failure also still occurs on a production-shaped `performance / 4096 MiB` machine with a 30 second pre-park drain, so matching the screenshot's guest shape does not make the fresh smoke-created machine suspend cleanly.
- Extending the suspend wait to 120 seconds only delayed the same eventual fallback. The failed production-shaped machine `4d893955c35408` showed `start` at `21:04:12` and the explicit user `stop` at `21:06:13`, which matches the longer timeout rather than a true `suspending` transition.
- Recent real Fly event streams for the failing tests showed `stop -> exit (requested_stop=true)` without a `suspending` or `suspended` transition.
- Production observations after the latest deploy suggest many machines are still reconciling and parking successfully as `suspended`, so the local tests are currently painting a worse picture than production.
- In the screenshot comparison set, all six machines share the same image (`1.1.99`), region (`fra`), and `performance / 4096 MiB` placement, but the stopped machines are younger than the suspended machines. That makes project or machine history a stronger candidate than raw config drift.
- A targeted backend hardening landed in `packages/backend/src/services/studioMachines/fly/provider.ts`: if runtime cleanup fails with the startup `503`, the park path now waits for runtime readiness and retries cleanup once before falling through. The focused provider regression coverage is green, but this did not change the real warm-wake outcome on `vivd-studio-dev`.
- On `vivd-studio-dev`, a direct machine-level control still degraded to `stop` even after the runtime had fully reached `/health -> {"status":"ok"}`, `POST /vivd-studio/api/cleanup/preview-leave` returned `200`, `/vivd-studio/api/cleanup/status` reported `state:"idle"` with every tracked subsystem (`bucket_sync`, `workspace_state_reporter`, `usage_reporter`, `agent_lease_reporter`, `opencode_runtime`) at `idle`, and the raw Fly `POST /suspend` endpoint itself returned `200 {"ok":true}`.
- The same direct control showed the remaining runtime process set was already minimal: the guest only had the main `entrypoint.sh`, the main `node dist/index.js`, `hallpass`, and the entrypoint loop's `sleep 1`, with no leftover OpenCode server child and no pending sync trigger file. The pause file `/tmp/vivd-sync.pause` was present, which means the current cleanup status is truthful about the requested pause but still does not explain the Fly stop fallback.
- A production-shaped warm-wake smoke pinned to the actual prod image `ghcr.io/vivd-studio/vivd-studio:1.1.99` also fell back to `stop` on `vivd-studio-dev`, with the same clean `SIGINT -> SIGTERM -> exit 0` log pattern as the current dev tag. That means the harsher local/test picture is not unique to the current dev image; the `vivd-studio-dev` app or the fresh standalone test-project path is harsher than current production.
- The warm-wake smoke itself had two real harness bugs and they are now fixed: path-prefixed `MAIN_BACKEND_URL` values are preserved when the optional backend-callback helper builds tRPC URLs, and `VIVD_FLY_TEST_MAIN_BACKEND_URL` is no longer coupled to `VIVD_FLY_WAKE_VERIFY_BACKEND_CALLBACKS`.
- The provider also had a real prod-shape gap: the one-time “restart and re-park” recovery path only retried for machines up to `2048 MiB`. That limit is now removed, and the focused orchestration regression is updated to prove the retry still runs on `performance / 4096 MiB` machines.
- Even after that retry fix, the real production-shaped warm-wake smoke on `vivd-studio-dev` still stopped twice in a row on `1.1.100`: the first park attempt fell back to `stop`, the provider restarted the same machine and retried park, and the second attempt also ended in `stop`.
- The strongest control experiment so far is no longer Studio-specific: on April 9, 2026, a throwaway `nginx:alpine` machine created in the same `vivd-studio-dev` app, with the same `performance / 4096 MiB` guest shape and `autostop: "suspend"`, also turned a direct Fly `POST /suspend` into `stopping -> stopped`.
- That means the current failure is not explained by Studio runtime auth, quiesce, OpenCode, or the provider's explicit stop fallback alone. At minimum it is app-level to the current Fly app surface; it may be broader Fly behavior, but that could not be isolated further from this machine because the available token is not authorized to create a fresh throwaway Fly app for a second control.
- On April 13, 2026, the GitHub release workflow was still running the Fly smokes without `FLY_STUDIO_CPU_KIND` or `FLY_STUDIO_MEMORY_MB`, which means the provider defaulted to `shared / 1024 MiB` even though production machines are `performance / 4096 MiB`. That was a real test-shape mismatch in the workflow itself, independent of the runtime image.
- A new production-shaped smoke now exists in `packages/backend/test/integration/fly_prod_shape_reconcile_wake_auth.test.ts`. It boots a drift image, explicitly stops that drifted machine, warm-reconciles it to the candidate image, requires the reconciled machine to end `suspended`, then wakes the same machine again and verifies runtime auth + bootstrap auth.
- The publish workflow now points at that production-shaped smoke and sets `FLY_STUDIO_CPU_KIND=performance`, `FLY_STUDIO_CPUS=1`, and `FLY_STUDIO_MEMORY_MB=4096` so the release job matches the normal production guest shape instead of the old `shared / 1024 MiB` default.
- Even with that better test shape and prod-like guest sizing, the new production-shaped smoke still fell back to `stopped` on `vivd-studio-dev` (`machine=e82620ec70e168`) during the final warm-reconcile park step. That means the remaining false-negative problem is no longer “fresh machine suspends too early”; it is now mostly the validate app behaving harsher than `vivd-studio-prod`.
- Production `1.2.2` continues to show the same split as before: healthy machines such as `68372d2bd33518` record `update -> start -> suspending -> suspended`, while the persistent outliers such as `e2869e7dcd29d8` record `update -> start -> stop -> exit(requested_stop=true)`. So the current validate-app failure is still materially worse than the production picture.

### Production comparison set from the current machine overview screenshot

- `stopped`
- `e2869e7dc29d8` (`marketinggutscheine-de / v1`, `fra`, `performance / 1 vCPU / 4096 MiB`, image `1.1.99`)
- `3d8d24d3c53408` (`marketinggutscheine-de / v1`, `fra`, `performance / 1 vCPU / 4096 MiB`, image `1.1.99`)
- `4d893902fe0658` (`almust / v1`, `fra`, `performance / 1 vCPU / 4096 MiB`, image `1.1.99`)
- `suspended`
- `080467db179418` (`test-2 / v1`, `fra`, `performance / 1 vCPU / 4096 MiB`, image `1.1.99`)
- `68372d2bd33518` (`pho-dam-restaurant / v1`, `fra`, `performance / 1 vCPU / 4096 MiB`, image `1.1.99`)
- `286d923cedd128` (`felix-nudels-with-pesto / v1`, `fra`, `performance / 1 vCPU / 4096 MiB`, image `1.1.99`)

### Open questions

- What production-relevant test shape, if any, behaves better locally than `shared / 1024 MB`, `shared / 2048 MB`, and `performance / 4096 MiB` on `vivd-studio-dev`?
- Do we need a dedicated prod-clone validation app for release smoke coverage, instead of the current `vivd-studio-dev` target, now that the new prod-shaped smoke still fails there while `vivd-studio-prod` remains mostly healthy?
- Are the production stopped outliers tied to a narrow class of machines rather than a general runtime regression?
- Is the remaining skew primarily app-level (`vivd-studio-dev` / `vivd-studio-prod`) or broader Fly suspend behavior that changed after the earlier `v1.1.92` successes?
- Why did some older `1.1.99` production machines appear as `suspended` in the April 9, 2026 screenshot if a same-app minimal control now also stops on direct `/suspend`?
- Which of the new suspend hardening code paths are genuinely required once the test-vs-production mismatch is understood?

## Signal Classification

Use these signals before changing provider/runtime suspend code again:

- Treat it as a likely Fly app or platform issue when a direct `POST /suspend` on a fully idled machine still records `stop -> exit(requested_stop=true)` with no `suspending` event, or when a same-app minimal-image control reproduces the same fallback.
- Treat it as a likely harness issue when the release workflow is validating the wrong guest shape, when the smoke fails before the real warm-reconcile phase starts, or when the test is asking a just-created machine to suspend immediately after its own startup/bootstrap traffic.
- Treat it as a likely validate-app parity issue when `vivd-studio-dev` consistently fails the prod-shaped smoke but `vivd-studio-prod` shows mostly healthy `suspended` machines on the same image and guest shape.
- Treat it as a likely Vivd runtime issue when runtime cleanup never reaches `idle`, auth/bootstrap traffic remains active after the preview-leave step, or production and validation both regress on the same image through the same post-start cleanup/park path.
