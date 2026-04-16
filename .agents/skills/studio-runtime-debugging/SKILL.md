---
name: studio-runtime-debugging
description: Use when debugging Studio runtime lifecycle, scratch-to-Studio handoff, embedded or tenant-host Studio reopen, OpenCode session behavior, persistence/rehydrate/revert issues, or the related local Docker/image smokes. This skill helps classify whether the failure is in bootstrap, runtime routing, live session execution, or persisted state restoration.
---

# Studio Runtime Debugging

Use this skill when a Studio bug sits somewhere between the host page, the Studio runtime, OpenCode session state, persistence, and the local browser/image smokes.

## Quick Workflow

1. Classify the failure before changing code:
   - bootstrap / iframe / routing / tenant reopen
   - live OpenCode session cutoff or idle transition
   - persistence / rehydrate / revert / restart state loss
   - smoke or harness false negative
2. Start with the smallest protecting proof:
   - `npm run typecheck -w @vivd/studio`
   - `npm run typecheck -w @vivd/frontend`
   - relevant targeted `vitest` files for the touched layer
3. If the bug is Docker/self-host/image-shaped, rebuild the real runtime:
   - `npm run build:studio:local`
4. Run the real smoke only after the targeted checks:
   - `STUDIO_IMAGE=vivd-studio:local npm run studio:host-smoke`
   - `STUDIO_IMAGE=vivd-studio:local npm run studio:image:revert-smoke`
5. Use the specific reference file that matches the symptom instead of loading everything:
   - host bootstrap, iframe, initial generation, tenant reopen:
     [references/host-smoke.md](references/host-smoke.md)
   - persisted state, bucket sync, restart rehydrate, revert durability:
     [references/opencode-persistence.md](references/opencode-persistence.md)

## Triage Map

- Local Docker/self-host Studio boots oddly, gets stuck on “Starting studio”, or tenant reopen differs from control-plane:
  read [references/host-smoke.md](references/host-smoke.md)
- Initial generation seems to stop, but you are not sure whether the agent really died:
  read [references/host-smoke.md](references/host-smoke.md) first
- Edits work locally, but revert/rehydrate/restart loses state:
  read [references/opencode-persistence.md](references/opencode-persistence.md)
- You need the broad validation ladder or non-Studio test guidance:
  use `.agents/skills/testing/SKILL.md`
- The same symptom only reproduces on Fly or involves suspend/wake/reconcile:
  use `.agents/skills/fly-studio-machines/SKILL.md`

## Useful Inputs To Confirm Early

Before a long debugging pass, confirm:

- which runtime surface is affected:
  - control-plane embedded Studio
  - tenant-host Studio reopen
  - local Docker host smoke
  - Studio image revert smoke
  - Fly runtime
- which image/model/env are actually in use:
  - `STUDIO_IMAGE` / `DOCKER_STUDIO_IMAGE`
  - `OPENCODE_MODEL_STANDARD`
  - `VIVD_STUDIO_HOST_SMOKE_MODEL`
  - `OPENROUTER_API_KEY`
- whether the user has a concrete failing artifact already:
  - `metrics.json`
  - `compose.log`
  - `failure.png`
  - container name or session id

For Studio git/snapshot oddities, also confirm:
- current `HEAD`
- whether the runtime is actively pinned to an older snapshot
- whether source sync is being skipped because an older snapshot is loaded
- whether the workspace only looks dirty because it is being compared against a loaded older snapshot instead of `HEAD`

## Guardrails

- Do not weaken the product or smoke contract before classifying the failure.
- Do not assume preview/dev-server trouble means the OpenCode session died.
- Do not assume a reopen/bootstrap failure means persistence is broken.
- Do not assume a persistence failure means the live session logic is broken.
- Rebuild the Studio image before trusting a rerun after runtime-side code changes.
- Older-snapshot viewing is session-local runtime state. It should not live as a normal project-root git file, and source sync should not export it into bucket-backed source artifacts.
