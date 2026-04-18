---
name: fly-studio-machines
description: Use when changing or debugging Fly-based Studio machine startup, wake/reconcile behavior, runtime auth, env drift, or release smoke coverage. This skill protects fast suspended wakes and helps diagnose cold-boot fallbacks in production-shaped flows.
---

# Fly Studio Machines

Use this skill when touching Fly Studio lifecycle or auth code or when a Fly-backed Studio machine is waking slowly, cold-booting unexpectedly, or failing runtime callbacks after startup.

## Quick Workflow

1. Read `references/drift-and-debugging.md` before changing wake, reconcile, or auth behavior.
2. Classify the failure before editing:
   - runtime image or boot-path regression
   - backend provider or orchestration bug
   - smoke or harness timing bug
   - Fly app or platform behavior
3. Preserve the stable machine-env invariants:
   - never put user-scoped or request-scoped values in machine env
   - keep `MAIN_BACKEND_URL` canonical rather than derived from whichever host opened Studio
   - make warm reconcile and normal start resolve the same stable env surface
   - keep machine runtime auth separate from browser user auth
4. Prove warm resume versus cold boot before changing code.
5. For production debugging, prefer read-only live inspection before changing code:
   - use the local user's `fly` or `flyctl` CLI when available
   - if this repo's `.env` exposes `PROD_FLY_API_TOKEN`, it may be used for read-only prod Fly inspection when the user explicitly wants production debugging
   - if host-level logs would help more than Fly machine logs, ask the user for the prod server IP or SSH access details explicitly
6. If you touch this area, update the protecting regressions and any release-critical smoke coverage.

## Durable Rules

- Compare a known-good image tag and a suspect tag through the same provider path before blaming orchestration.
- Treat runtime cleanup and preview-leave as part of the suspend contract, not as best-effort telemetry.
- Keep `suspended` expectations strict. Do not weaken lifecycle assertions just to get CI green.
- If a minimal-image control in the same Fly app also falls back to `stopped`, suspect app or platform behavior before adding more Vivd quiesce logic.
- If Fly API polling hits rate limits, treat that as provider or harness behavior first, not proof of a suspend regression.
- Treat `PROD_FLY_API_TOKEN` as sensitive: do not print it, and do not mutate prod machines unless the user explicitly asks for that.
- If backend-host SSH would help and the user has not provided access details yet, ask for them explicitly.

## Where To Start

- Provider lifecycle and orchestration: `packages/backend/src/services/studioMachines/fly/lifecycle.ts`
- Focused unit and regression anchors:
  - `packages/backend/test/fly_provider_reconcile.test.ts`
  - `packages/backend/test/fly_provider_orchestration.test.ts`
  - `packages/backend/test/trpc_context_org_procedure.test.ts`
  - `packages/backend/test/studio_api_router.test.ts`
- Real behavior tests:
  - `packages/backend/test/integration/fly_reconcile_flow.test.ts`
  - `packages/backend/test/integration/fly_warm_wake_auth.test.ts`
  - `packages/backend/test/integration/fly_prod_shape_reconcile_wake_auth.test.ts`

## Release Surfaces

Release-impacting lifecycle or auth changes should also be checked against:

- `scripts/publish.sh`
- `.github/workflows/reusable-validate.yml`
- the relevant image smoke scripts when runtime behavior is release-critical

## References

- Read [references/drift-and-debugging.md](references/drift-and-debugging.md) for the longer drift, auth, and cold-boot debugging notes.
- Prefer `vendor/opencode` for OpenCode runtime behavior and server or app flow comparisons.
- Prefer `vendor/dokploy` for self-hosting and infra-management comparisons when relevant.
