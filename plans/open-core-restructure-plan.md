# Open Core Restructure Plan

Date: 2026-04-15  
Owner: repo/core/plugin platform  
Status: proposed

This document turns the current self-host direction into a concrete repo and architecture plan:

- make the existing self-hostable single-tenant path the real open-source core
- publish a stable plugin SDK
- keep plugins outside the strict core boundary
- move shared-control-plane SaaS/platform concerns into additive platform packages
- add a controlled external-embed plugin model without opening the door to arbitrary runtime package execution

It builds on:

- [plans/self-hosting-profile-split-plan.md](./self-hosting-profile-split-plan.md)
- [plans/plugin-sdk-v2-plan.md](./plugin-sdk-v2-plan.md)

## Recommendation

Yes: separating `core`, `plugin-sdk`, and `platform` is useful for the codebase itself, not just for licensing.

The repo already has three real concerns that want different boundaries:

- the self-hostable single-tenant product shape (`solo`)
- the plugin extension surface
- the shared-control-plane / multi-org / hosted-platform layer

The existing code already points this way:

- `InstallProfileService` and the `solo` vs `platform` split already distinguish a simpler single-tenant install from a broader hosted/platform shape
- first-party plugins are already being extracted behind generic backend/frontend/CLI contracts
- platform-only concepts like tenant hosts, cross-org admin, and entitlement overrides already create cognitive weight that the default self-host path does not need

The important adjustment is this:

- do not force everything into one giant `packages/core` workspace
- treat `core` as a product slice and distribution boundary made from several packages
- create a small, explicit `plugin-sdk` package for public extension APIs
- move platform-only code out gradually, behind interfaces and capability gates, instead of trying to refactor the whole repo in one shot

## Target Boundary

### Core

Open-source, self-hostable, and independently usable without cloud code.

Core is the single-tenant product slice.

That means:

- self-host/core distribution runs one standalone core deployment for one entity
- the hosted platform should also consume that same core slice as the per-tenant product/runtime surface, rather than maintaining a separate tenant app that drifts from self-host/core
- self-hosting is therefore one way to ship core, not the definition of core by itself

Core should include:

- the main single-tenant app/backend/frontend flow
- Studio runtime and workspace editing flow
- auth, users, sessions, invites, and member management
- one owning organization or tenant boundary retained internally
- projects, publish flow, versions, previews, and normal domain management
- plugin host/runtime composition
- instance-level plugin availability and simple limits/defaults
- the CLI needed to operate the core product

Core should not require:

- multi-org SaaS administration
- tenant-host routing for unrelated orgs
- org/project entitlement matrices
- billing, marketplace, licensing enforcement, or managed-cloud services

Important rule:

- keep the current organization/project model internally where it reduces churn
- simplify the default product shape to one owning org rather than ripping the org abstraction out of the codebase
- define core around "one tenant / one entity product surface", even when that same slice is embedded inside a larger hosted platform composition

### Plugin SDK

Open-source public package with stable APIs for plugin authors.

The SDK should contain:

- plugin manifest types
- capability and permission contracts
- backend contribution contracts based on injected ports, not backend-internal imports
- frontend/studio/CLI contribution contracts
- install/update compatibility contracts
- external-embed provider manifest types

The SDK should not contain:

- backend service implementations
- frontend shell internals
- superadmin/platform policy logic
- database tables or runtime code that only core hosts can provide

### Plugins

Keep plugins outside the strict core boundary as separate packages.

Recommended shape:

- `core` owns the plugin host/runtime and the extension points
- `plugin-sdk` owns the public authoring contract
- first-party plugins remain separate `plugins/native/*`
- core may ship with an official open plugin bundle, but plugin implementations should not define the core boundary

That gives a cleaner result than baking Contact Form, Analytics, Newsletter, and future plugins directly into a monolithic core package.

### Platform

Closed or source-available platform packages layered on top of core.

Platform should be thought of as:

- one-or-many core tenant slices
- plus shared cross-tenant and hosted-service concerns layered above them

Platform should own:

- multi-org/shared-control-plane administration
- tenant-host routing and org-pinned host behavior
- advanced org/project plugin entitlement overrides
- managed SaaS fleet operations and cloud-only operations
- marketplace, billing, premium licensing, and managed services
- premium plugins or platform-only bundles

Dependency rule:

- `core` must not import platform or premium code
- `plugin-sdk` depends only on open contracts
- `platform` and premium layers may import `core` and `plugin-sdk`
- platform services should import only public core/plugin-sdk exports, ports, and facades; if platform needs a new seam, add it explicitly to core instead of reaching into core-internal source paths
- platform should compose core, not fork or bypass it for the tenant-facing product surface

## Why The Split Helps Technically

This split improves the code even if licensing never changed.

Benefits:

- the self-host story becomes simpler because platform-only concepts stop leaking into default admin, routing, and entitlement paths
- plugin work gets a stable public surface instead of growing out of `@vivd/shared` by accident
- first-party and future third-party plugins can depend on a documented API instead of backend/frontend internals
- testing becomes easier because `core` and `platform` get distinct validation targets
- release management gets cleaner because self-host/core fixes do not need to drag along every platform concern

The main technical warning is over-splitting too early.

Avoid these mistakes:

- creating one giant `packages/core` that collapses backend/frontend/studio into a worse package boundary
- trying to support arbitrary runtime npm plugin loading before the SDK and host contract are stable
- publishing a folder as “open core” while it still depends on hidden platform behavior to be usable

## Package And Repo Shape

Keep the monorepo.

Recommended near-term shape:

- keep `packages/backend`, `packages/frontend`, `packages/studio`, `packages/cli`, `packages/shared`, `packages/theme`, and the needed self-host runtimes as the core package set
- add `plugins/sdk` for stable public plugin APIs
- keep `plugins/native/*` as separate plugin packages
- treat `plugins/installed` as the current official bundle/composition package, and rename it later only when multiple bundles actually exist
- add platform packages only when the extracted surface is real, for example `packages/platform-backend`, `packages/platform-frontend`, and `packages/platform-shared`
- add a dedicated self-host distribution package or app for install assets when ready, instead of keeping distribution concerns implicit inside docs

Recommended non-goal:

- do not do a cosmetic rename wave before the boundary is real

In practice, “open core” should mean:

- a set of open packages and docs that build and run together as the single-tenant product
- the same single-tenant product slice that the hosted platform reuses for one tenant
- not a forced file move into one workspace named `core`

## Concrete Extraction Targets

Start with the seams that already exist.

### 1. Plugin SDK extraction from `@vivd/shared`

Move the stable plugin authoring surface out of `packages/shared` into `plugins/sdk`.

Likely first exports:

- `packages/shared/src/types/pluginContracts.ts`
- `packages/shared/src/types/pluginPackages.ts`
- `packages/shared/src/types/plugins.ts`
- `packages/shared/src/types/pluginCli.ts`

Migration rule:

- `packages/shared` remains internal/shared repo plumbing
- `plugins/sdk` becomes the documented public plugin surface
- keep temporary compatibility re-exports for one migration window only

### 2. Bundle composition from `plugins/installed`

The current `installed-plugins` package is already close to an official plugin bundle.

Use it as the first composition seam:

- official open plugins bundle for self-host/core
- later optional premium/platform bundles

Do not make plugin discovery equal runtime marketplace installation.

### 3. Platform extraction from existing host packages

Priority extraction targets:

- `packages/backend/src/services/system/InstallProfileService.ts`
- `packages/backend/src/services/plugins/PluginEntitlementService.ts`
- `packages/backend/src/services/publish/DomainService.ts`
- `packages/backend/src/trpcRouters/superadmin*.ts`
- `packages/frontend/src/pages/SuperAdmin.tsx`
- `packages/frontend/src/components/admin/organizations/**`
- tenant-host-specific router and host-resolution paths

Extraction rule:

- publish-domain management needed by a single self-host instance stays in core
- managed tenant hosts and cross-org host behavior move toward platform
- instance-level plugin defaults stay core
- org/project entitlement override layers move toward platform

## Plugin Model

Use one plugin UX, but separate the internal plugin kinds.

Supported kinds:

- `native`
- `external_embed`
- `connected`

Recommended rollout:

- now: `native` + guided `external_embed`
- later: selected `connected`
- not now: arbitrary npm package support or paste-random-code plugin installs

### Native plugins

These are the current first-party plugin shape:

- powered by Vivd backend/core services
- may expose public routes
- may ship custom frontend/studio/CLI contributions

Examples:

- Contact Form
- Analytics
- Newsletter

### External embed plugins

These are controlled provider integrations for static sites and Astro projects.

Examples:

- booking widgets
- reservation widgets
- chat widgets
- maps
- buy buttons
- analytics tags

They should be manifest-driven, not arbitrary code execution.

Recommended manifest additions in `plugin-sdk`:

- `pluginType: "native" | "external_embed" | "connected"`
- `provider`
- `inputSchema`
- `renderMode: "iframe" | "script" | "html" | "head_tag" | "body_tag" | "link"`
- `placement`
- `consentCategory`
- `requiresSecrets`
- `requiresBackend`
- `setupGuide`
- `validationRules`
- `previewSupport`
- `publishChecks`
- `securityPolicy`

Core behavior for external embeds:

- provider cards in the plugin catalog
- structured setup UI
- validation instead of free-form script dumping
- preview support or a clear preview fallback
- publish checks for consent, CSP, host allowlists, or missing config

### Connected plugins

Reserve this for later integrations with real server-side adapters:

- OAuth-backed integrations
- webhooks
- CRM sync
- advanced Stripe flows

These should use the same top-level plugin UX, but require an explicit backend adapter contract and clearer secret/runtime policy than the first `external_embed` phase.

## GitHub Repo Strategy For Plugins

Using GitHub repos for plugins can be useful, but it should be treated as a distribution choice, not the primary architecture decision.

Recommended sequence:

1. Stabilize the `plugin-sdk`.
2. Stabilize bundle/install contracts inside the monorepo.
3. Support plugins coming from separate GitHub repos at build/install time.

Why not earlier:

- without a stable SDK, external repos just freeze today’s internal seams in public
- without a bundle/install contract, GitHub repos turn into ad-hoc package loading

Recommended long-term direction:

- official plugins can stay in this monorepo or move out selectively
- community plugins can live in separate GitHub repos
- the install flow should pin versions and validate compatibility
- plugin code should be installed deliberately at build/deploy time, not fetched and executed dynamically at runtime

External-embed provider packs are the best candidate for early GitHub-based distribution because they can often be mostly manifest/templates/docs with limited runtime code.

## Migration Phases

### Phase 0: Boundary decision and package map

- ratify the `core` / `plugin-sdk` / `platform` split
- define which current packages are part of the open core package set
- document which current files are clearly platform-only

### Phase 1: Introduce `plugins/sdk`

- create the package
- move public plugin contracts out of `packages/shared`
- add compatibility re-exports from `@vivd/shared/types`
- document the public SDK surface and what remains internal

### Phase 2: Finish the plugin contribution contract

- build on the current manifest + contribution work
- make every host consume one package-level contribution shape
- let bundles describe the installed plugin set cleanly
- keep backend dependency injection host-owned

### Phase 3: Turn `solo` into the actual core composition

- treat the current self-host/single-tenant path as the target product shape
- keep one-org member/project management in core
- simplify admin copy, defaults, and routing around that assumption

### Phase 4: Extract platform-only behavior

- split multi-org admin out of default core surfaces
- split tenant-host-specific routing/governance out of core defaults
- reduce plugin entitlement logic in core to instance-level defaults and simple availability
- move org/project override layers to platform code

### Phase 5: Add `external_embed` support

- extend manifest contracts
- add provider-driven UI and validation
- add preview/publish checks
- start with curated providers only

### Phase 6: Create the self-host/core distribution package

- make the open core independently installable and documented
- move install/distribution assets into a dedicated package or app
- make docs consume that distribution source of truth

### Phase 7: License and release split

- mark open vs closed folders explicitly
- publish/package the open core and plugin SDK
- keep platform and premium packages layered on top
- update README, docs, and CI to describe the mixed-license layout precisely

### Phase 8: Optional external plugin repo flow

- add a supported install flow for GitHub-hosted plugins
- validate compatibility on install
- keep runtime loading explicit and controlled

## Exit Criteria

This migration is complete when all of the following are true:

- the self-hostable single-tenant product can be described and shipped as a coherent open core
- `plugin-sdk` is the documented public plugin API instead of `@vivd/shared`
- first-party plugins build against the SDK without backend-internal imports
- platform-only code no longer defines the default self-host mental model
- external embeds work as controlled provider integrations, not raw code paste
- folder/package licensing matches the actual technical boundary
