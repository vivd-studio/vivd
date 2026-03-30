# Fly Studio Machines Reference

Read this file when touching Fly Studio startup, wake/reconcile behavior, connected-mode auth, or when debugging slow/broken Studio boots in prod.

## Core Behavior

- Fly `suspended` does not guarantee a true hot resume. A later start can still fall back to a cold boot.
- Warm reconcile intentionally pays the full cold path once:
  - image boot
  - source hydration
  - OpenCode hydration
  - Studio startup
  - workspace init
  - then park the machine
- The next user open is only fast if:
  - Fly actually resumes the parked snapshot
  - Vivd does not detect drift that forces `update -> stopped -> start`

## What Causes Drift And Cold Starts

- User-scoped or request-scoped values in managed machine env.
  - Past regressions: `SESSION_TOKEN`, organization role, request-host-derived callback URLs.
- `MAIN_BACKEND_URL` changing across opens for the same machine.
  - Do not derive it from whichever host opened Studio if that can vary across `vivd.studio`, `default.vivd.studio`, or tenant hosts.
- Nondeterministic derived env values.
  - Sort enabled plugin ids before writing them into env.
- Warm reconcile using a different env surface than normal Studio start.
  - Warm reconcile must preserve the same stable machine/project env that normal start expects.

## Connected-Mode Auth Rules

- Machine-authenticated backend calls use:
  - `x-vivd-studio-token`
  - `x-vivd-studio-id`
  - `x-vivd-organization-id`
- Do not reintroduce tenant context into drifting machine env just to make backend callbacks work.
- Non-default-tenant callbacks can legitimately hit the global control-plane host; backend context must still honor the runtime token org when the org header matches the authenticated runtime.
- Keep machine-scoped auth separate from browser user auth.

## Debugging Patterns

- Signs of a real cold boot:
  - Firecracker/init logs again
  - source hydration/OpenCode hydration logs again
  - late `Studio server running on http://0.0.0.0:3100`
  - machine events like `launch -> created`, `update -> stopped`, `start -> started`
- Signs of a fast resume:
  - machine starts almost immediately
  - no full hydration path
  - readiness in sub-second to a few seconds range
- If Studio shows misleading usage-limit style failures, inspect runtime callback logs first.
  - A real prod failure here was `401 Studio runtime is not authorized for this organization`, not actual limit exhaustion.

## Fly Debugging Tips

- Use the local user's `fly` or `flyctl` CLI directly when available.
- If backend-host SSH access would help and the user has not provided host/access details yet, ask for them explicitly instead of guessing.
- Useful things to inspect:
  - `fly logs -a vivd-studio-prod -i <machine-id>`
  - machine events, state, image, and env
  - whether the machine still carries legacy env that should have been scrubbed
- Compare:
  - machine metadata identity
  - machine env stable subset
  - desired env subset at start/reconcile time

## Other Findings From Past Incidents

- Warm wake can be fast even when cold boot is still expensive. We measured a healthy path with:
  - cold boot around tens of seconds
  - warm wake under 1 second
- If suspend misses and a cold boot happens, dev-server dependency install can add another large delay.
- Missing files in the Studio image can leave reconciled machines `stopped` rather than `suspended`; image boot smoke must catch that before release.
- Retired model ids can make advanced-model chat look broken even when Studio startup is fine; release-time model smokes should cover configured tiers.
