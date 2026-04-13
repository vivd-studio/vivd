---
name: fly-studio-machines
description: Use when changing or debugging Fly-based Studio machine startup, wake/reconcile behavior, runtime auth, env drift, or release smoke coverage. This skill protects fast suspended wakes and helps diagnose cold-boot fallbacks in production-shaped flows.
---

# Fly Studio Machines

Use this skill when touching Fly Studio lifecycle/auth code or when a prod Studio machine is waking slowly, cold-booting unexpectedly, or failing runtime callbacks after startup.

## Quick Workflow

1. Read `references/drift-and-debugging.md` before changing wake/reconcile/auth behavior.
2. Preserve the stable machine-env invariants:
   - never put user-scoped or request-scoped values in machine env
   - keep `MAIN_BACKEND_URL` canonical rather than derived from whichever host opened Studio
   - make warm reconcile and normal start resolve the same stable env surface
   - keep machine runtime auth separate from browser user auth
3. When debugging, distinguish a true suspend resume from a cold boot before changing code.
4. Use the local user's `fly` or `flyctl` CLI when available; if backend-host SSH would help and the user has not provided access details yet, ask for them explicitly.
   - In this repo's current setup, `.env` may include `PROD_FLY_API_TOKEN`; use it carefully for read-only inspection of `vivd-studio-prod` machine list/status/logs when the user explicitly wants production debugging. Do not print the token or mutate prod machines unless the user explicitly asks for that.
5. If you touch this area, update or propose the protecting regressions and release smokes instead of leaving the new behavior undocumented.

## Regression Playbook

- If a Fly reconcile or wake smoke starts failing on `suspended` expectations, first prove whether the regression is in backend orchestration or in the Studio runtime image itself.
- Do that by A/B probing published image tags with the same provider path:
  - boot the machine with a known-good tag and call `provider.stop(...)` / `provider.parkStudioMachine(...)`
  - boot the machine with the suspect tag and repeat the exact same path
  - if the old tag suspends and the new tag falls back to `stopped`, treat it as a runtime-image regression before changing backend lifecycle code
- Do not assume `:latest` is a safe drift baseline. If the latest published Studio image is itself broken, the warm-reconcile smoke will fail before it even reaches the candidate image. Pin `VIVD_FLY_TEST_DRIFT_IMAGE` / `FLY_STUDIO_RECONCILE_BASELINE_TAG` to the last known-good Studio tag until a fixed release is published.
- As of April 2, 2026, the release-smoke drift baseline should stay on `v1.1.51-repro.2`: that is the last known-good published Studio tag that completed the real GitHub validate-app fly reconcile smoke. Earlier plain semver tags such as `v1.1.50` are no longer available in GHCR, so using them today silently falls back to older images and obscures what the workflow is actually validating.
- Be suspicious of Studio boot-path changes that eagerly initialize extra runtime subsystems during normal startup. In particular, eager imports or startup work that pulls OpenCode / initial-generation logic into every Studio boot can change Fly suspend behavior even when backend/Fly orchestration code is unchanged.
- If the old Studio image suspends and the new one does not, but the repo diff is empty or irrelevant, compare the built image artifacts directly before touching provider code. On April 2, 2026, `v1.1.66-flybaseline.2` suspended locally and `v1.1.68` did not under the same Fly warm-wake test even though the key Studio file trees matched; the real diff was transient build artifacts baked into the runtime image (`/root/.npm/_logs/*` and `/tmp/node-compile-cache/*`). Treat build-time caches/logs left in the Studio image as suspend-risky until proven otherwise, and clear them from the runtime image.
- If a real suspend smoke is still falling back to `stopped` after the runtime reports cleanup idle, stop assuming it is necessarily a Vivd runtime bug. On April 9, 2026, a direct `POST /suspend` on `vivd-studio-dev` still produced `stopping -> stopped` even after `/vivd-studio/api/cleanup/status` reported every tracked subsystem idle, and a same-app `nginx:alpine` control machine with `autostop: "suspend"` reproduced the same fallback. Before adding more provider/runtime quiesce code, run a same-app minimal-image control: if that also stops, treat the problem as Fly app/platform behavior until proven otherwise.
- If `fly_warm_wake_auth.test.ts` fails on `expected 'stopped' to be 'suspended'` right after runtime auth/bootstrap, do not jump straight from that symptom to “runtime image regression”. On April 2, 2026, the real missing step was that the smoke never simulated the Studio preview closing: the product client sends `/vivd-studio/api/cleanup/preview-leave` before the machine is parked, and parking without that close signal can leave the runtime active long enough for Fly suspend to fall back to `stopped`. The smoke now uses one-shot runtime requests, explicitly calls the preview-leave cleanup endpoint, and still keeps a short post-bootstrap drain window before asserting `suspended`; preserve that behavior when debugging or refactoring this test.
- Keep the warm-wake smoke's connected-mode helpers honest. On April 9, 2026, the optional backend-callback verification path was found to strip path prefixes from `MAIN_BACKEND_URL` by building callback URLs from absolute `"/api/..."` paths, and the smoke only injected `MAIN_BACKEND_URL` when callback verification was enabled. Both bugs are now fixed: path-prefixed backend URLs must be preserved, and `VIVD_FLY_TEST_MAIN_BACKEND_URL` should be injectable independently from the optional callback assertion.
- Treat the preview-leave cleanup path as part of the suspend contract, not as best-effort telemetry. A `200` from `/vivd-studio/api/cleanup/preview-leave` is only meaningful if the handler actually quiesces the runtime before returning. As of April 2, 2026, that means pausing `WorkspaceStateReporter` and awaiting `opencodeServerManager.stopServer(...)`; firing cleanup in the background was not enough to keep Fly from falling back to `stopped`.
- Apply that same cleanup rule to the backend warm-reconcile path, not only to browser-driven smokes. On April 2, 2026, `v1.1.76` still failed GitHub's `studio-fly-reconcile-smoke` even though the direct warm-wake smoke was green, because `warmReconcileStudioMachineWorkflow` booted the replacement image, waited for `/health`, and then re-parked it without telling the runtime to quiesce first. The fix was to have the provider call `/vivd-studio/api/cleanup/preview-leave` with the machine access token before the final suspend in both reconcile workflows, then keep a short post-cleanup settle window before asserting the machine is parked.
- If `fly_reconcile_flow.test.ts` fails on the first suspend step immediately after creating the drifted machine, treat it as a likely harness-timing issue before blaming the reconciler. That test creates the drift image via `ensureRunning()` and then parks it right away, which means Fly can still be seeing the provider's own readiness traffic. As of April 2, 2026, the smoke keeps a short post-start drain window before the first `provider.stop(...)` so it is suspending a settled drifted machine rather than the provider's just-probed startup path. Keep the `suspended` assertion; only adjust the pre-park settle behavior if you can show the smoke itself is generating the last active traffic.
- If the release workflow is supposed to say something about production suspend behavior, make the guest shape explicit in CI. On April 13, 2026, the publish workflow was still omitting `FLY_STUDIO_CPU_KIND` and `FLY_STUDIO_MEMORY_MB`, so the provider silently validated on `shared / 1024 MiB` even though normal production Studio machines were `performance / 4096 MiB`. Treat that as a harness bug; set the workflow guest shape deliberately instead of relying on provider defaults.
- Do not rely only on a fresh-machine suspend smoke for release confidence. The more production-like question is whether an already non-running drifted machine can be warm-reconciled back to the desired image, re-park as `suspended`, and then warm-wake with working auth. `packages/backend/test/integration/fly_prod_shape_reconcile_wake_auth.test.ts` exists for that reason and should carry more release weight than the older “fresh machine parks immediately after bootstrap” path.
- If the prod-shaped smoke still fails on `vivd-studio-dev` while `vivd-studio-prod` shows mostly healthy `suspended` machines on the same image, stop treating that as proof the image is bad. That is a validate-app parity problem until proven otherwise; compare the validate app itself to prod or move release validation onto a prod-clone Fly app before adding more generic suspend logic.
- If a Fly reconcile or wake smoke starts failing almost immediately with `resource_exhausted: rate limit exceeded`, treat that as a provider polling bug before treating it as a suspend regression. On April 2, 2026, the failing release reconcile flow had only one live test machine, and the real abort came from `getMachine()` inside `waitForReady()` rather than from a machine state transition. `packages/backend/src/services/studioMachines/fly/lifecycle.ts` now backs off and retries when Fly rate-limits `getMachine()` in the `startMachineHandlingReplacement()`, `waitForReady()`, and `waitForState()` loops. Preserve that behavior: a transient Fly API throttle should not make the whole warm-reconcile or warm-wake flow look like a machine lifecycle failure.
- Do not assume the provider's retry path covers production-shaped guests unless the regression test says so. On April 9, 2026, the one-time “restart and re-park” recovery was still limited to `<= 2048 MiB`, which meant all real `performance / 4096 MiB` machines skipped it even though that is the normal prod shape. The focused orchestration test now proves the retry still runs on 4 GiB suspend-capable machines.
- Do not weaken the suspend contract in tests to get CI green. `fly_reconcile_flow.test.ts` is supposed to prove the real e2e story: drifted machine suspends, warm reconcile updates it, and wake stays fast.

## Protecting Tests

- `packages/backend/test/fly_provider_reconcile.test.ts`
- `packages/backend/test/fly_provider_orchestration.test.ts`
- `packages/backend/test/trpc_context_org_procedure.test.ts`
- `packages/backend/test/studio_api_router.test.ts`
- `packages/backend/test/integration/fly_warm_wake_auth.test.ts`
- `packages/backend/test/integration/fly_prod_shape_reconcile_wake_auth.test.ts`

Release-impacting lifecycle/auth changes should also be reflected in:

- `scripts/publish.sh`
- `.github/workflows/reusable-validate.yml`
- the image smoke scripts when the runtime behavior is release-critical

## Reference Checkouts

Prefer the checked-out upstream repos in `vendor/` over stale repo notes when you need implementation references:

- `vendor/opencode` for OpenCode runtime behavior, UI parity, and server/app flow comparisons
- `vendor/dokploy` for self-hosting and infra-management patterns when those comparisons are relevant
