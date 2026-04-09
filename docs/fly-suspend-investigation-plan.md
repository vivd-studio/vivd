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

- [ ] Re-run `fly_warm_wake_auth.test.ts` with a more production-like suspend-eligible config.
- [ ] Re-run `fly_reconcile_flow.test.ts` with the same config.
- [ ] Compare `shared/1024`, `shared/2048`, and the closest safe production-like test shape that Fly suspend still supports.
- [ ] Use `v1.1.92` as the known-good control without re-running it unless later evidence makes that necessary.

### 2. Compare tests against production reality

- [ ] List current production Studio machines after the latest deploy/reconcile pass.
- [ ] Bucket them by final parked state: `suspended`, `stopped`, `started`, other.
- [ ] Identify a small set of stopped outliers and a matching set of healthy suspended machines for comparison.
- [ ] Capture the concrete machine ids, image tags, guest shape, region, and most recent relevant events for both groups.

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

- [ ] Review whether the smokes still generate extra traffic or timing pressure that production does not.
- [ ] Check whether the reconcile smoke parks the drifted machine too soon after startup relative to production.
- [ ] Check whether warm-wake auth is still holding runtime/browser/session activity longer than the real product path.
- [ ] Decide whether any harness timing changes are warranted without weakening the real `suspended` contract.

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

- What production-relevant test shape, if any, behaves better locally than `shared / 1024 MB` and `shared / 2048 MB`?
- Are the production stopped outliers tied to a narrow class of machines rather than a general runtime regression?
- Why do fresh smoke-created machines on the current image fail to suspend locally even when older production machines on the same image and guest shape can still end up `suspended`?
- Which of the new suspend hardening code paths are genuinely required once the test-vs-production mismatch is understood?
