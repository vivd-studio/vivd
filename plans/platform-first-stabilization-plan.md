# Platform-First Stabilization Plan

Date: 2026-04-16  
Owner: product/platform  
Status: proposed

This document records the current near-term correction for Vivd:

- support the hosted `platform` posture as the only supported product mode for now
- keep `solo` and public self-hosting behind internal or experimental flags
- remove self-host and operator-heavy positioning from the public docs
- simplify plugin policy around the hosted product instead of optimizing both install shapes equally
- continue only the subset of `refactor/open-core` that clearly reduces coupling without adding new extension architecture we do not need yet

## Recommendation

Yes: the correction is real.

The current `solo` and self-host story is creating product, docs, and policy weight that is disproportionate to the near-term business need. The codebase is no longer suffering mainly from random conditionals; it is carrying two product shapes with different routing, plugin policy, and operational surfaces.

No: the full `refactor/open-core` branch should not be landed as-is.

That branch contains two very different kinds of work:

- useful cleanup that centralizes policy, trims coupling, and prepares cleaner plugin boundaries
- a larger package and extension architecture that adds indirection right when the product goal is to narrow scope

The right move is to keep the cleanup direction, but not the full architectural expansion.

## Findings

### Current footprint on `main`

The `solo` / `platform` split is materially present, but mostly through a few shared seams:

- about `22` non-test backend files
- about `8` non-test frontend files
- about `20` test files
- about `44` docs, plan, and config files

The highest-signal complexity is concentrated in:

- install-profile and capability resolution in `packages/backend/src/services/system/InstallProfileService.ts`
- routing and topology in `packages/backend/src/services/publish/DomainService.ts` and `packages/backend/src/services/studioMachines/runtimeAccessResolver.ts`
- plugin entitlement policy in `packages/backend/src/services/plugins/PluginEntitlementService.ts`
- self-host operations in `packages/backend/src/services/system/InstanceNetworkSettingsService.ts`, `packages/backend/src/services/system/InstanceSoftwareService.ts`, and `scripts/sync-self-host-assets.ts`
- public docs and install assets under `packages/docs` and `packages/docs/public/install/`

### Plugin-specific finding

The plugin model still hardcodes install-profile policy into plugin definitions through `defaultEnabledByProfile`.

That is already a questionable boundary on `main`, and `refactor/open-core` currently keeps that same field inside the new public `packages/plugin-sdk` contracts. That would turn install-profile policy into a public plugin authoring concern, which is the opposite of the simplification we want.

### `refactor/open-core` branch finding

The branch is substantial:

- `230` files changed
- `7336` insertions
- `3674` deletions

It is not one thing. It mixes:

- `plugin-sdk` extraction from `packages/shared`
- install-profile/app-config policy helper extraction
- platform package extraction (`packages/platform-backend`, `packages/platform-frontend`, `packages/platform-shared`)
- admin surface bundle and extension registries across the frontend
- generic procedure factories and bundle wiring for backend super-admin surfaces

## Decision

For now, Vivd should treat the hosted `platform` shape as the only supported product posture.

That means:

- `platform` is the default and supported runtime mode
- `solo` remains internal or experimental only
- public docs should not market or explain self-hosting as a normal user journey
- product UI should stop teaching the `solo` / `platform` split to normal users
- plugin defaults and availability policy should be owned by the host product, not by plugin packages

This does not mean deleting every `solo` code path immediately. It means reducing the supported surface first, then deleting dead branches after the platform-only path has stabilized.

## Recommended Implementation Plan

### Phase 1: Bound the supported product posture

Introduce one backend-owned gate for the unsupported path, for example:

- `VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE`

Recommended behavior:

- when the flag is off, `platform` is the effective default posture
- `VIVD_INSTALL_PROFILE=solo` is ignored or rejected unless the experimental flag is enabled
- frontend app config exposes whether the current instance is in an experimental self-host posture so the UI does not need ad hoc checks

Goal:

- one supported posture
- one place where unsupported posture is permitted

### Phase 2: Fix plugin policy ownership

Remove install-profile ownership from plugin packages.

Specifically:

- remove `defaultEnabledByProfile` from plugin contracts
- move plugin default availability into host-owned instance policy or installed bundle policy
- keep plugin packages responsible for capabilities, config, actions, reads, and UI metadata only
- after the current SDK port lands, schedule an explicit follow-up refactor to remove any copied install-profile policy from the new SDK surface before treating that port as stable

Hosted-platform recommendation:

- keep one clear entitlement story for the product you actually run
- if org/project entitlement overrides are still needed for hosted operations, keep them
- if not, collapse them toward instance default plus per-project enablement

Do not publish or stabilize a public `plugin-sdk` until this policy boundary is corrected.

### Phase 3: Put solo and self-host operations behind flags

Keep the code bootable internally, but stop treating it as a supported surface.

Targets:

- self-host network settings UI and Caddy management
- managed self-host updates
- self-host install asset generation
- self-host-only routing affordances that are not needed for the hosted product

Near-term rule:

- internal compatibility is acceptable
- public product commitment is not

### Phase 4: Rewrite public docs around end users

Public docs should focus on:

- creating a project
- generating a site
- editing in Studio
- enabling and configuring plugins
- publishing and managing domains
- teams, collaboration, and support

Public docs should stop focusing on:

- self-host install and update flows
- compose bundles and Caddy/TLS setup
- operator-heavy configuration matrices

If self-host documentation is still needed internally, move it to internal repo docs or plans rather than leaving it in the public docs information architecture.

### Phase 5: Reduce test and release surface

Default validation should emphasize:

- hosted platform flows
- plugin policy behavior for the hosted product
- Studio lifecycle in the deployed platform posture

Keep at most:

- a narrow internal `solo` smoke or compatibility test

Do not keep broad public-product coverage for a mode that is not supposed to be supported.

### Phase 6: Delete dead code after a stabilization window

After one or two stable releases with `solo` hidden and internal-only:

- remove dead UI branches
- remove stale docs and install surfaces
- collapse now-unused profile conditionals
- reassess whether `InstallProfileService` still needs full dual-profile support or only an experimental override path

## `refactor/open-core` Assessment

### Keep or cherry-pick

The following direction is useful and should be preserved in some form:

- install-profile and app-config helper extraction that centralizes policy checks instead of repeating `solo` / `platform` branches
- plugin SDK extraction from `packages/shared` into a dedicated package
- installed-plugin host bundle seams that make backend/frontend/cli/studio plugin loading more explicit
- smaller composition-oriented refactors that keep large routers and admin surfaces from growing further

These changes help even in a platform-only strategy because they reduce coupling and make future extraction easier.

### Defer or avoid for now

The following parts of the branch are likely too much architecture for the current goal:

- admin surface bundle and extension registries across the frontend
- extracting the supported product posture into optional installed platform bundles
- backend super-admin procedure factories with broad dependency-injection wrappers
- the broader open-core framing as the main near-term architecture driver

Why:

- if `platform` is the only supported product right now, turning it into an optional extension package is backwards
- stability comes more from fewer moving parts than from more abstract composition layers
- extension registries and bundle metadata add indirection before there is a second real supported runtime that needs them

### Important correction to the branch

If the `plugin-sdk` work continues, fix this before landing it:

- do not carry `defaultEnabledByProfile` into the public SDK

That policy belongs to the host product or installed bundle, not to the public plugin contract.

## Practical Recommendation

Do not abandon the refactor direction entirely.

Instead:

1. continue the small, local cleanup seams from `refactor/open-core`
2. pause the large package and extension architecture
3. stabilize around one supported platform posture
4. revisit open-core and self-host only after the hosted product is materially stronger

In other words:

- the branch is directionally right about boundary cleanup
- it is too ambitious as a full landing for the current product strategy

## Exit Criteria

This correction is complete when:

- `platform` is the only supported public posture
- `solo` requires an explicit experimental flag
- public docs no longer present self-hosting as a normal product path
- plugin contracts no longer encode install-profile defaults
- user-facing admin and plugin copy no longer pivots on `solo` vs `platform`
- only a narrow internal compatibility path remains for `solo`
