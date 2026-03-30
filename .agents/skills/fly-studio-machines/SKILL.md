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
5. If you touch this area, update or propose the protecting regressions and release smokes instead of leaving the new behavior undocumented.

## Protecting Tests

- `packages/backend/test/fly_provider_reconcile.test.ts`
- `packages/backend/test/fly_provider_orchestration.test.ts`
- `packages/backend/test/trpc_context_org_procedure.test.ts`
- `packages/backend/test/studio_api_router.test.ts`
- `packages/backend/test/integration/fly_warm_wake_auth.test.ts`

Release-impacting lifecycle/auth changes should also be reflected in:

- `scripts/publish.sh`
- `.github/workflows/reusable-validate.yml`
- the image smoke scripts when the runtime behavior is release-critical

## Reference Checkouts

Prefer the checked-out upstream repos in `vendor/` over stale repo notes when you need implementation references:

- `vendor/opencode` for OpenCode runtime behavior, UI parity, and server/app flow comparisons
- `vendor/dokploy` for self-hosting and infra-management patterns when those comparisons are relevant
