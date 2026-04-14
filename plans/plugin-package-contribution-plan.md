# Plugin Package Contribution Refactor Plan

Date: 2026-04-11  
Owner: backend + frontend + studio + cli  
Status: proposed

This document defines the next refactor step for the plugin architecture after the initial package extraction work for Analytics and Contact Form.

It complements:

- [plans/plugin-system-design.md](./plugin-system-design.md) for overall product/plugin scope
- [plans/plugin-registry-refactor-plan.md](./plugin-registry-refactor-plan.md) for registry-driven discovery/listing surfaces

This plan is narrower than the full plugin system design and deeper than the registry refactor. Its focus is one problem:

> a plugin package should contribute enough executable surface that host apps can register it from one package-level source of truth instead of repeating backend runtime maps, public-route lists, and per-surface descriptor arrays.

## Problem Statement

Vivd is in an in-between state:

- plugin metadata, shared UI metadata, and CLI help/rendering can now live in extracted plugin packages
- backend still has separate manual runtime maps and public route registration lists
- Studio does not yet consume the same plugin set as the other host surfaces
- a plugin package can look "registered" while still not being runnable

Today, adding a new plugin package still requires manual edits in multiple host-owned places before the plugin is actually operational.

The main gaps are:

- `PluginPackageDescriptor` is not executable enough to describe the backend contribution
- backend runtime modules are wired separately from package descriptors
- public plugin HTTP routes are enumerated in backend host code
- plugin-specific compatibility procedures still exist for some richer surfaces
- Studio plugin descriptor registration can drift from frontend/backend/CLI

That architecture is workable for a small number of first-party plugins, but it is not clean enough to use as the stable baseline before adding more plugins.

## Goals

- Make one package-level contribution object the source of truth for plugin metadata and executable registration.
- Let backend derive plugin definitions, plugin IDs, runtime modules, backend hooks, and public route registrations from the same contribution list.
- Let frontend, Studio, and CLI consume the same package-level contribution shape instead of maintaining surface-local partial descriptor lists.
- Keep host apps responsible for generic routing, auth, dependency injection, and composition.
- Keep plugin packages responsible for plugin-specific behavior, config schemas, snippets, custom pages, CLI help, and public runtime handlers.
- Preserve a first-party plugin model for now while removing unnecessary host-side ceremony.

## Non-Goals

- Arbitrary third-party plugin loading at runtime
- Remote marketplace installation
- Per-plugin sandboxing or code isolation
- A fully schema-driven plugin settings UI
- Eliminating every plugin-specific compatibility endpoint in the same change

## Desired End State

After this refactor, adding a new first-party plugin package should require:

1. creating the package and exporting one contribution object
2. adding the package as a dependency where a host imports it
3. adding that contribution to each host's plugin contribution list
4. updating Docker/workspace plumbing where required

It should not require:

- a separate backend `pluginModules` map
- a separate backend public route registry list
- a Studio-only descriptor list that can drift from frontend/CLI
- duplicating plugin metadata across surfaces

## Key Design Decision

Replace the current "descriptor plus extra host maps" model with a single package-level **plugin contribution** contract.

The contribution contract should be expressive enough that each host can derive what it needs directly from the plugin package:

- shared metadata
- backend runtime module factory
- public HTTP route registrations
- backend integration hooks
- frontend module
- Studio shared UI metadata
- CLI module

The host still owns dependency injection and global routing composition. The plugin package should not import backend internals directly.

## Proposed Shared Contract

The existing `PluginPackageDescriptor` should be replaced or evolved into a richer contract in `packages/shared`.

Suggested direction:

```ts
import type express from "express";
import type { PluginCliModule } from "./pluginCli.js";
import type {
  PluginDefinition,
  PluginModule,
} from "./pluginContracts.js";
import type { SharedProjectPluginUiDefinition } from "./plugins.js";

export interface PublicPluginRouteDefinition<TContext> {
  routeId: string;
  mountPath: string;
  createRouter: (context: TContext) => express.Router;
}

export interface PluginBackendContribution<
  TPluginId extends string = string,
  TContext = unknown,
  THooks = unknown,
> {
  createModule: (context: TContext) => PluginModule<TPluginId>;
  publicRoutes?: PublicPluginRouteDefinition<TContext>[];
  hooks?: THooks;
}

export interface PluginPackageContribution<
  TPluginId extends string = string,
  TBackendContext = unknown,
  TFrontend = unknown,
  THooks = unknown,
> {
  pluginId: TPluginId;
  definition: PluginDefinition<TPluginId>;
  sharedProjectUi?: SharedProjectPluginUiDefinition;
  cli?: PluginCliModule;
  frontend?: TFrontend;
  backend?: PluginBackendContribution<TPluginId, TBackendContext, THooks>;
}
```

The exact type names can change, but the contract needs these properties:

- backend contribution is explicit
- public route contribution is explicit
- hooks are attached to the backend contribution instead of floating separately
- one package export is sufficient to understand what the plugin contributes

## Backend Context Boundary

The backend contribution should receive a host-owned context object rather than importing backend internals directly.

Suggested backend context shape:

```ts
export interface VivdPluginBackendContext {
  services: {
    projectPluginInstanceService: typeof projectPluginInstanceService;
    pluginEntitlementService: typeof pluginEntitlementService;
    analyticsPluginService: typeof analyticsPluginService;
    contactFormPluginService: typeof contactFormPluginService;
    // or narrower services per plugin during migration
  };
  publicHttp: {
    upload: Pick<Multer, "none">;
  };
}
```

The final context should be narrower than this example. The important rule is:

- plugin packages depend on shared types and injected host services
- plugin packages do not import `@vivd/backend/src/...`

For Analytics and Contact Form, the first migration step can keep narrow runtime adapters, but they should be attached through the plugin contribution object instead of separate host registries.

## Route Contribution Model

Visitor-facing plugin routes should move out of the backend-local hardcoded route list and become package-level route contributions.

The host should still mount them centrally:

```ts
const registrations = pluginContributions.flatMap((plugin) =>
  plugin.backend?.publicRoutes ?? [],
);

for (const registration of registrations) {
  router.use(registration.mountPath, registration.createRouter(context));
}
```

The host remains responsible for:

- global CORS policy
- shared middleware ordering
- upload middleware setup
- top-level mount points

The plugin owns:

- the route identity
- its internal Express router
- the runtime handler implementation

## Surface Consumption Rules

### Backend

Backend should derive from the contribution list:

- `PLUGIN_IDS`
- plugin definitions
- plugin catalog entries
- executable plugin modules
- backend integration hooks
- public route registrations

It should no longer keep separate manual maps for runtime modules or public routes.

### Frontend

Frontend should derive from the contribution list:

- shared project UI registry
- frontend module registry

It should not need a separate plugin-owned descriptor plus a separate manually merged frontend module object.

### Studio

Studio should consume the same contribution shape as frontend for shared UI metadata and any future Studio-owned plugin surfaces.

At minimum, it should stop maintaining a narrower plugin list than frontend/CLI unless that difference is intentional and encoded as a capability flag.

### CLI

CLI should keep the generic grammar, but derive help/aliases/renderers from the contribution list.

## Migration Plan

### Phase 1: Introduce the contribution contract

- Add the new shared plugin contribution types in `packages/shared`.
- Keep the old descriptor type temporarily as a compatibility alias if that reduces churn.
- Add host-local helpers that can extract definitions, modules, frontend modules, CLI modules, hooks, and public routes from contribution lists.

### Phase 2: Convert Analytics and Contact Form exports

- Replace `analyticsPluginDescriptor` with `analyticsPluginContribution`.
- Replace `contactFormPluginDescriptor` with `contactFormPluginContribution`.
- Move backend hooks under `backend.hooks`.
- Move public route registrations under `backend.publicRoutes`.
- Keep backend runtime adapters during this step if they are still needed, but attach them through `backend.createModule`.

### Phase 3: Collapse backend manual registration

- Remove the manual `pluginModules` map in `packages/backend/src/services/plugins/registry.ts`.
- Remove the hardcoded public route list in `packages/backend/src/httpRoutes/plugins/registry.ts`.
- Derive backend hook registries from `backend.hooks` on the contribution list.

### Phase 4: Unify host surface registration

- Replace per-surface descriptor arrays with contribution arrays in:
  - backend
  - frontend
  - studio
  - cli
- If a surface intentionally ignores part of a plugin contribution, it should do so by selecting fields from the same contribution object rather than maintaining a different plugin list.

### Phase 5: Trim compatibility layers

- Keep legacy plugin-specific tRPC procedures only where the payload shape is still intentionally richer than the generic contract.
- Move as much plugin-specific logic as possible into plugin packages or generic host transport helpers.
- Remove compatibility files that become pure pass-throughs.

## Design Constraints

### 1. Keep the host generic

Host apps should keep ownership of:

- auth
- tRPC composition
- Express app composition
- dependency injection
- storage/DB/network providers
- Docker/workspace/package wiring

### 2. Keep plugin packages self-describing

A plugin package should expose enough information that a reader can answer:

- what is this plugin called
- what does it configure
- what CLI help/rendering does it provide
- what frontend page does it provide
- what backend module does it contribute
- what public routes does it expose

without searching multiple host-owned registries.

### 3. Do not overfit to runtime loading yet

This refactor is for clean first-party package composition, not dynamic external loading.

The contract should be compatible with a future curated-NPM model, but the current implementation can remain statically imported and workspace-owned.

### 4. Do not block on entitlement-schema cleanup

The current entitlement schema still leaks Contact Form-specific Turnstile fields. That remains a real follow-up, but it should not block the contribution-contract cleanup.

If a third plugin needs plugin-specific entitlement policy before that cleanup lands, add a targeted follow-up plan for generic policy storage rather than inflating this refactor.

## Risks

### Over-generalizing backend context

If the backend context object becomes too broad, the plugin package boundary will look cleaner without actually becoming cleaner.

Mitigation:

- keep injected contexts narrow
- prefer plugin-specific runtime interfaces over one giant service bag

### Keeping old and new registries alive too long

If the migration leaves both descriptor lists and contribution lists around for long, drift will return quickly.

Mitigation:

- convert both existing plugins promptly
- delete redundant maps in the same refactor sequence

### Treating Studio differences as accidental when they are intentional

Some plugin surfaces may genuinely belong only in frontend or only in Studio.

Mitigation:

- encode surface-specific contributions as fields on one contribution object
- do not solve surface differences by maintaining separate plugin lists

## Definition Of Done

This refactor is complete when all of the following are true:

- every first-party plugin package exports one contribution object as its main host-facing contract
- backend derives plugin IDs, definitions, runtime modules, backend hooks, and public routes from contribution objects
- frontend, Studio, and CLI derive their plugin registrations from contribution objects
- there is no separate backend-local public route registration list
- there is no separate backend-local executable plugin module map
- Studio no longer drifts from the shared plugin set by default
- a short authoring guide exists describing how to start a new plugin package with the contribution contract

## Recommended Immediate Follow-Up

Implement this refactor before adding another plugin package.

The first coding slice should be intentionally small:

1. add the shared contribution contract
2. convert Analytics
3. convert Contact Form
4. derive backend public routes from contributions
5. derive backend modules from contributions
6. switch Studio to the same contribution source

Once that lands, adding the next plugin will validate whether the architecture is actually clean enough.
