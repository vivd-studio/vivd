# Vivd Project State (Current)

> Goal: run Vivd as a reliable multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and predictable publish/preview flows.

## Current Focus

- Finish the OpenCode-aligned Studio chat/runtime refactor and keep agent UX moving toward upstream parity.
- Keep Studio machine lifecycle reliable across Fly and the newer single-host Docker provider.
- Close the remaining scratch-to-Studio initial-generation gaps.
- Keep this file tightly scoped to active work and move retired detail into the archive.

## Current Status

- Architecture split is stable: control plane (`packages/backend`) + isolated studio runtime (`packages/studio`).
- Bucket-first runtime for source, preview, and publish is active.
- Fly studio machine orchestration is operational for core lifecycle paths.
- Single-host Docker studio-machine orchestration is available behind `STUDIO_MACHINE_PROVIDER=docker` and is still getting parity hardening.
- Multi-org auth and tenant host scoping are implemented across core control-plane paths.
- The public docs workspace is live, and the self-hosting profile split foundation is now in progress across backend, routing, and frontend.

## Latest Progress

- 2026-03-19: fixed the host-page case your browser screenshot exposed for Docker Studio boot. If the first embedded `/vivd-studio?...` document load returns a temporary `503` but the runtime `/health` endpoint goes healthy shortly after, the control-plane frontend now auto-reloads the iframe instead of waiting forever behind the manual `Reload` button.
- 2026-03-19: hardened the same-origin Studio iframe detector itself in the control-plane frontend. Host pages no longer require a matching `/vivd-studio/assets/...` tag shape to clear the boot overlay; they now also accept a mounted React `#root`, which covers Docker/runtime HTML shapes where the Studio app is visibly alive but the old asset-path heuristic never matched.
- 2026-03-19: tightened the pinned-host org-switcher fix so it stays platform-only. `packages/frontend/src/components/shell/AppSidebar.tsx` now only exposes alternate organization choices when multi-org is enabled, preventing legacy multi-org data from surfacing misleading org-switch options in `solo` installs while preserving the redirect-based fix for `platform` tenant hosts.
- 2026-03-19: fixed the org-switcher dead end on pinned hosts in `packages/frontend/src/components/shell/AppSidebar.tsx`. The sidebar now still lists available organizations when the current host is pinned to one org, and selecting another org uses the existing redirect flow to the tenant host or control-plane host instead of hiding every option behind the old “Organization pinned to this domain” message.
- 2026-03-19: added a concise install-profile hint to `AGENTS.md` so contributors see the current default immediately: `solo` is the one-host default, while the SaaS-style multi-org host-based mode is now the explicit `VIVD_INSTALL_PROFILE=platform` opt-in.
- 2026-03-19: flipped the install-profile fallback to `solo` and wired the bootstrap envs through the compose surfaces. `packages/backend/src/services/system/InstallProfileService.ts` now resolves `solo` when no stored or explicit env profile is set, `docker-compose.yml` and `docker-compose.prod.yml` now pass `VIVD_INSTALL_PROFILE` plus the instance bootstrap JSON envs through to the backend, and `.env.example` now documents a single-host `solo` default while making `VIVD_INSTALL_PROFILE=platform` the explicit opt-in for the SaaS-style host-based mode.
- 2026-03-19: fixed another control-plane Studio host-page timeout edge case. The same-origin iframe readiness poll now keeps running in the background after the 25s timeout UI appears, so slightly slow Docker boots or late shell availability no longer get stuck behind the `Reload` / `Hard restart` overlay once the Studio iframe is actually ready.
- 2026-03-19: tightened the Studio initial-generation task prompt in `packages/studio/server/services/initialGeneration/InitialGenerationService.ts` so it stays much closer to the original backend scratch-generation wording while reflecting the Astro workspace flow. The prompt now explicitly asks for a modern, fully-fledged, high-converting finished version 1 in the same run, preserves the old style-preset and exact-vs-reference color-token semantics, and still allows the agent to use the Studio question tool if an important clarification is genuinely needed.
- 2026-03-19: reverted the earlier light-mode semantic softening after it made important red/green controls harder to spot. Light mode now uses stronger filled primary, success, destructive, and toast styling again, while dark mode keeps the lighter outline treatment; Super Admin and organization plugin tables still use explicit success variants for enabled and deployed states so those actions remain semantically distinct.
- 2026-03-19: hardened the control-plane Studio host pages against false startup timeouts for same-origin runtimes such as the Docker path-mounted provider. `packages/frontend/src/pages/EmbeddedStudio.tsx`, `packages/frontend/src/pages/StudioFullscreen.tsx`, and `packages/frontend/src/pages/ProjectFullscreen.tsx` now keep polling briefly for the real Studio shell after the iframe mounts instead of relying on a one-shot `load`/`vivd:studio:ready` handshake, and a focused `EmbeddedStudio` regression test now covers the “early load event, shell becomes ready shortly after” case.
- 2026-03-19: added and iterated on a new shared `aurora` color theme across `packages/theme`, `packages/frontend`, and `packages/studio/client`, pushing it closer to the dark reference look with deeper main surfaces while keeping the hot magenta/red energy concentrated in smaller accents instead of large fills; matching sidebar treatment and selector previews were updated in both control-plane and Studio UI.
- 2026-03-19: softened the darkest red/green semantic chrome across `packages/frontend` and `packages/studio/client`: shared destructive buttons/badges now switch to a tinted outline treatment in dark mode, success/error toasts no longer render as fully solid blocks there, and the main publish/status success banners were aligned to the same lighter dark-theme surface treatment.
- 2026-03-19: landed the first end-to-end self-hosting profile split across backend, routing, and frontend. `packages/backend/src/services/system/InstallProfileService.ts` now resolves install profile, capability flags, instance plugin defaults, instance limit defaults, and single-project defaults from system settings plus env bootstrap; app config exposes that policy to the frontend; plugin access and usage-limit resolution are now instance-first; project-creation max-project checks inherit instance defaults; same-host `solo` installs now generate current-host plugin/email endpoints and route `/plugins/*` plus email feedback through both the main `Caddyfile` and generated published-site Caddy configs; and the frontend admin shell now exposes an instance settings workspace with `solo`/`platform`-aware navigation and instance-level plugin toggles/limits instead of always forcing the full org-centric SaaS admin UI.
- 2026-03-19: added an OpenCode-style review surface in Studio chat with per-turn diff previews (`messageDiff`, `Files edited`, and inline unified diff rendering for completed runs).
- 2026-03-17 to 2026-03-19: pushed the OpenCode chat refactor forward with canonical controller/runtime ownership, first-class `question` support, reusable session-activity indicators, inline session-error/status handling, lighter completed-run chrome, and transcript modularization around the new `message-list/` split.
- 2026-03-17 to 2026-03-19: kept scratch-to-Studio initial generation moving by starting the Astro handoff flow, forcing first-draft generation onto the advanced model tier, and fixing host-page bootstrap replay so runtime restarts do not resend the initial generation prompt.
- 2026-03-18 to 2026-03-19: closed more Docker single-host parity gaps with image auto-pull, platform fallback, compose-network resolution, stale-container self-healing, path-prefix/ready-state fixes, preview asset rewrite fixes, bounded reconcile concurrency, and a new 2 GiB default memory baseline.
- 2026-03-19: fixed a Super Admin studio-image selector bug that could hide freshly pushed `dev-<gitsha>` Studio images. GHCR non-semver dev tags now keep registry order instead of being re-sorted lexicographically, and the Machines image-options query now asks for a wider dev-tag window so new Docker test images surface more reliably in the selector.
- 2026-03-18 to 2026-03-19: documented a self-hosting split in `docs/self-hosting-profile-split-plan.md` around `solo` vs `platform` install profiles and clearer instance/org/project policy boundaries.
- 2026-03-17 to 2026-03-18: brought the public docs workspace online and stabilized it with routing, branding, screenshot, content, and runtime compatibility fixes.

## Active Priorities

1. Finish the OpenCode-aligned Studio chat refactor plan in `docs/opencode-chat-refactor-plan.md`, especially remaining review/diff, question, and transport/state cleanup.
2. Fix the failing Fly rehydrate/revert integration (`packages/backend/test/integration/fly_opencode_rehydrate_revert.test.ts`) and validate lifecycle sync hardening in real Fly runs.
3. Finish scratch-to-Studio initial-generation hardening and connected end-to-end verification.
4. Keep advancing Docker single-host parity so local and self-hosted Studio runtimes behave like the Fly path.
5. Implement reversible project archiving, superadmin project transfer, and app-login landing/post-login tenant redirect.
6. Execute SSE migration Phase 1, add targeted cross-service E2E smoke coverage, and finish removing remaining local-FS assumptions from backend paths.

## Open Decisions

| Question | Status |
|---|---|
| Fly app strategy (single app vs app-per-tenant) | TBD |
| Concurrency model for edits (single-writer lock vs optimistic) | TBD |
| Build execution location (backend vs studio vs dedicated builder) | TBD |
| Preview artifact exposure (public vs signed URLs) | TBD |
| Studio URL pattern (iframe route vs redirect vs subdomain) | TBD |
| Self-hosting boundary (`solo` vs `platform`, and instance/org/project policy split) | In progress in `docs/self-hosting-profile-split-plan.md`; profile foundation, instance-first policy resolution, same-host `solo` routing, `solo` UI gating, and `solo` runtime defaults are landed, while migration-path docs remain |

## Archive

- Historical progress entries and trimmed detail are in `docs/PROJECT_STATE_ARCHIVE.md`.
