# Fly Suspend Investigation Plan

> Goal: explain why the real Fly suspend/reconcile smokes are consistently falling back to `stopped` from this machine while recent production behavior shows many machines still parking as `suspended`, then keep only the hardening that is justified by evidence.

## Working Assumptions

- `v1.1.92` is still the latest known state where the relevant tests reliably observed `suspended`.
- We are treating `v1.1.92` as the accepted known-good control unless later evidence forces a re-run.
- Current production behavior is better than the local test picture: most recent reconciled machines appear to be ending in `suspended`, with a smaller set of stopped outliers.
- The current local test shape may still be pessimistic relative to production, especially around machine size, timing, and machine history.
- We should avoid keeping broad suspend-specific hardening if production evidence and focused experiments show that part of it is unnecessary.

## Checklist

### 1. Re-establish the test matrix

- [x] Re-run `fly_warm_wake_auth.test.ts` with a more production-like suspend-eligible config.
- [ ] Re-run `fly_reconcile_flow.test.ts` with the same config.
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

### 5. Review current hardening for cleanup candidates

- [ ] Inventory the suspend-focused code changes made during this investigation.
- [ ] Mark each change as one of:
- [ ] keep because it fixes a proven product issue
- [ ] keep because it is cheap and low-risk
- [ ] remove or simplify because evidence does not support it
- [ ] If production evidence shows the issue is narrower than the local tests suggested, do a cleanup pass before merging.

### 6. Document the final learning

- [ ] Update `.agents/skills/fly-studio-machines/SKILL.md` with the confirmed lessons.
- [ ] Add the final outcome to `PROJECT_STATE.md`.
- [ ] Summarize which signals distinguish a real Fly/platform suspend fallback from a Vivd test/runtime issue.

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
- Are the production stopped outliers tied to a narrow class of machines rather than a general runtime regression?
- Why do fresh smoke-created machines on `vivd-studio-dev` fail to suspend locally even when older production machines on `vivd-studio-prod` with the same `1.1.99` image and guest shape can still end up `suspended`?
- Is the remaining skew primarily app-level (`vivd-studio-dev` vs `vivd-studio-prod`) or project-history-level (fresh standalone test projects vs older real projects)?
- Which of the new suspend hardening code paths are genuinely required once the test-vs-production mismatch is understood?
