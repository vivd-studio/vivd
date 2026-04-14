# Refactor and Hardening Plan

Date: 2026-03-25

## Goal

Turn the recent Studio redesign, OpenCode chat changes, Docker machine provider work,
self-hosting/profile split work, and docs rollout into a cleaner and safer baseline
without losing shipped behavior.

This is the umbrella cleanup plan. Keep more detailed subplans, especially
`plans/opencode-chat-refactor-plan.md`, as the source of truth for area-specific
implementation details.

## Related Docs

- `plans/opencode-chat-refactor-plan.md`
- `plans/opencode-chat-sync-analysis.md`
- `plans/self-hosting-profile-split-plan.md`
- `plans/old/refactoring-day-checklist.md`

## Rules For Closing Items

- [ ] Do not mark an item done until code, focused tests, and plans/config updates are in place.
- [ ] Fix externally reachable auth or data-exposure problems before structural cleanup.
- [ ] Prefer deleting duplicate paths over adding another compatibility layer.
- [ ] When config/env behavior changes, update `.env.example`, shared compose files, the self-host install bundle, and relevant docs in the same change.
- [ ] Keep `solo` and `platform` behavior explicit. Do not let routing or policy differences hide inside incidental condition chains.

## Phase 0: Safety And Exposure Fixes

- [x] Lock down private Studio runtime shell and preview routes so unpublished workspace content is not reachable without runtime auth.
- [x] Replace iframe query-token bootstrap with a short-lived Studio bootstrap flow that posts to the runtime, sets the cookie server-side, and redirects to a clean `/vivd-studio` URL without exposing the long-lived runtime token in browser-visible URLs.
- [ ] Separate private Studio preview from intentionally shareable/public preview behavior and document that policy clearly.
Current boundary: the Studio runtime shell and its private helper/API routes remain auth-gated, while the old runtime `/preview` and `/vivd-studio/api/devpreview` compatibility transport has now been removed. The control-plane external preview/share URL remains the separate `publicPreviewEnabled` decision until the broader preview-policy cleanup is finished.
- [x] Add regression tests proving unauthenticated requests cannot read private runtime content from the Studio shell and private runtime preview/API surfaces, including the now-removed legacy compatibility paths before cleanup.
- [ ] Review whether deterministic Docker runtime route ids are acceptable once auth is enforced everywhere; remove any accidental reliance on path secrecy.
- [ ] Re-review same-host object download exposure through `/_vivd_s3/*` and replace it with a narrower backend proxy or signed-download flow if the current MinIO passthrough is broader than intended.

## Phase 1: Finish The OpenCode Chat Cutover

- [ ] Make the workspace event pump the only live OpenCode subscription owner.
- [ ] Reduce `runTask()` to prompt submission plus identifier return; stop using a run-scoped stream as a second primary event source.
- [ ] Remove or quarantine the legacy `agent.sessionEvents` and `eventEmitter` transport once the `agentChat` path fully covers the chat UI.
- [ ] Move remaining chat state ownership out of `packages/studio/client/src/components/chat/ChatContext.tsx` and into `packages/studio/client/src/features/opencodeChat/` or clearly separated hooks.
- [ ] Stop the new timeline/render layer from depending on legacy `components/chat` parsing helpers.
- [ ] Replace `any`-heavy OpenCode payload handling with parsers or type guards at the transport edge.
- [ ] Finish question, review/diff, and follow-up/session-action work against the canonical store instead of extending legacy state paths.
- [ ] Delete the legacy chat modules listed in `plans/opencode-chat-refactor-plan.md` after cutover.

## Phase 2: Extract The Frontend Studio Host Shell

- [x] Extract shared start/restart/recover/runtime-url/access-token logic from `EmbeddedStudio.tsx`, `ProjectFullscreen.tsx`, and `StudioFullscreen.tsx`.
- [x] Extract shared iframe-ready, timeout-recovery, theme-sync, and hard-restart message handling into a common hook or host-shell module.
- [x] Keep page-specific responsibilities limited to surrounding layout, navigation, and page-only controls.
- [x] Add shared regression tests for early iframe load, timeout recovery, token propagation, hard restart, and initial-generation bootstrap.

## Phase 3: Unify Self-Hosting And Caddy Sources Of Truth

- [ ] Choose one source of truth for the `solo` self-host Caddy topology.
- [ ] Generate the published installer Caddyfile variants from that source instead of hand-maintaining parallel copies.
- [ ] Reduce drift between `docker-compose.yml`, `docker-compose.prod.yml`, and `packages/docs/public/install/docker-compose.yml`.
- [ ] Add a check or focused test that new backend env/config surfaces are propagated to every intended compose or install bundle.
- [ ] Keep primary-host publish behavior, plugin routes, email feedback routes, docs host routing, and runtime-route imports explicit across all supported topologies.
- [ ] Re-check the current `solo`/`platform` docs so they describe the actual shipped routing and operator responsibilities.

## Phase 4: Clean Provider Boundaries Around Docker And Fly

- [ ] Extract provider-neutral machine helpers out of `services/studioMachines/fly/*` so the Docker provider no longer imports Fly-specific modules for shared behavior.
- [ ] Define small provider contracts for image resolution, runtime auth, route publication, and reconcile drift detection.
- [ ] Keep provider-specific API clients, metadata models, and reconciliation details isolated behind those contracts.
- [ ] Add contract-style tests that Docker and Fly providers satisfy the same externally expected runtime behavior.

## Phase 5: Split Oversized Backend Service Ownership

- [ ] Split `DomainService` into smaller responsibilities: host resolution, registry/verification, publish allowlist policy, and managed tenant host maintenance.
- [ ] Split `PublishService` into artifact staging, redirect loading and validation, Caddy rendering, and publish-record mutation.
- [ ] Extract Caddy rendering into pure functions with snapshot-style tests.
- [ ] Tighten `InstanceNetworkSettingsService` validation so invalid host-like strings are rejected before persistence or Caddy generation.
- [ ] Keep install-profile policy, network settings, and publish/domain behavior coupled only through explicit interfaces.

## Phase 6: Raise Repo Hygiene And Quality Gates

- [ ] Remove unexpected workspace-local lockfiles that violate the repo package-manager rule, or explicitly document allowed exceptions for `vendor/`, examples, and generated sites.
- [ ] Add or finish backend/studio/scraper lint and typecheck scripts where they are still missing.
- [ ] Add a lightweight workspace verification command for the touched high-risk paths.
- [ ] Add a release-gating Studio canary in the publish pipeline that proves the candidate Studio image can actually boot, pass runtime/bootstrap auth, and execute at least one prompt on every configured model tier before the release is considered promotable.
- [ ] Keep `.env.example`, self-host docs, and installer docs aligned with the real supported config surface.
- [ ] Add a small change checklist for new runtime/auth/network/config surfaces so env and installer drift stops recurring.

## Validation Checklist

- [x] Private Studio runtime content is inaccessible without runtime auth.
- [x] Studio iframe bootstrap no longer exposes the long-lived runtime token in browser-visible URLs.
- [ ] Public preview behavior still works exactly where intended.
- [ ] Chat stays synchronized through reload, reconnect, stop, question, revert, and long-running tool flows.
- [ ] Docker and Fly runtime reuse refresh auth and env correctly.
- [ ] `solo` self-host installs and existing `platform` installs both render correct Caddy configs.
- [ ] Compose and install bundles carry the env variables required for current features.
- [ ] Docs reflect the shipped behavior for self-hosting, runtime auth, and operator config.

## Suggested Order

1. [ ] Phase 0
2. [ ] Phase 1 and Phase 2 together
3. [ ] Phase 3
4. [ ] Phase 4 and Phase 5
5. [ ] Phase 6

## Done Means

- [ ] The public and unauthenticated runtime surface is intentionally scoped and tested.
- [ ] The OpenCode chat stack has one clear live transport and one canonical client store.
- [ ] Studio host-page runtime logic is shared instead of triplicated.
- [ ] Self-hosting config is generated from one maintained source per topology.
- [ ] Docker and Fly provider code is provider-shaped rather than cross-importing internals.
- [ ] High-risk behavior has focused regression coverage.
