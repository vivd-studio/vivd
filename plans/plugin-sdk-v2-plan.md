# Plugin SDK V2 Plan

Date: 2026-04-16  
Owner: plugin platform  
Status: in progress

Supersedes:

- [plans/old/plugin-system-design-contact-forms-mvp-2026-02-15.md](./old/plugin-system-design-contact-forms-mvp-2026-02-15.md)
- [plans/old/plugin-registry-refactor-plan-2026-04-06.md](./old/plugin-registry-refactor-plan-2026-04-06.md)
- [plans/old/plugin-package-contribution-plan-2026-04-11.md](./old/plugin-package-contribution-plan-2026-04-11.md)

## Recommendation

Keep the current direction:

- dedicated `plugins/sdk`
- one installed-plugin composition package
- generic backend/frontend/CLI hosts
- plugin-owned implementation packages

Do not keep the current SDK shape unchanged.

The current code is a good internal native-plugin baseline, but the public contract is still too focused on first-party server-backed plugins and too mixed between:

- author-facing manifest contracts
- internal bundle/install plumbing
- host runtime contribution wiring

The next version should make plugin contribution types explicit and readable:

- `native`
- `external_embed`
- `connected`

That gives Vivd one plugin UX while keeping different authoring models for:

- built-in server-backed plugins
- guided third-party embed providers
- later backend/API integrations

## Current Assessment

### What is already good

- Plugin contracts have a real boundary in `plugins/sdk`.
- Installed plugins are composed from one canonical list in `plugins/installed/src/index.ts`.
- Frontend and CLI consumption are mostly generic.
- Backend host wiring is now much cleaner than before the recent registry cleanup.

### What is still awkward

- `PluginPackageInstallDescriptor` in `plugins/sdk/src/pluginPackages.ts` is an internal bundle/composition concept, not a good public plugin-authoring concept.
- `surfaceExports` is useful for code generation, but it should not be the mental model for plugin authors.
- `PluginDefinition` in `plugins/sdk/src/pluginContracts.ts` mixes catalog metadata, config/runtime capabilities, and UI list metadata into one object.
- External embeds are only described in plans, not in the real SDK contract.
- Current manifests assume a server-backed first-party plugin shape, even when the future target is “curated third-party embeds first”.

### Bottom line

If starting over today, the repo should still have:

- `plugin-sdk`
- `installed-plugins`
- host adapters

But the SDK should expose a clearer public model and hide more of the bundle/runtime plumbing behind internal helpers.

## Goals

- Keep first-party native plugins easy to build and reason about.
- Make plugin contribution types explicit from the manifest alone.
- Add first-class support for curated third-party embed providers.
- Keep arbitrary runtime code execution out of scope.
- Let catalog/setup/preview/publish UX derive from the same plugin manifest.
- Keep host-owned auth, routing, dependency injection, secrets, and policy out of plugin packages.

## Non-Goals

- Arbitrary npm package loading at runtime
- WordPress-style unrestricted server plugin execution
- A public marketplace before the SDK contract is stable
- Deep editor-extension APIs in the first external-plugin phase
- Per-plugin isolation/sandboxing in this phase

## Conventional CMS Plugin Families

Common plugin families in systems like WordPress, Webflow apps, or Shopify apps usually fall into a few buckets:

- forms and lead capture
- booking and reservations
- chat and support widgets
- analytics, pixels, and tag integrations
- maps and location embeds
- commerce and buy buttons
- reviews, testimonials, and social proof
- newsletter/signup embeds
- media/video/audio embeds
- SEO/schema/search tooling
- connected business integrations such as CRM, payments, and automation

For Vivd, the practical near-term subset should be:

- native first-party plugins
- curated `external_embed` providers
- a small later set of `connected` integrations

Vivd should not aim for general-purpose executable server plugins.

## Plugin Kinds

### `native`

Current first-party plugin shape.

Characteristics:

- may use Vivd backend runtime and DB
- may expose public routes
- may add frontend, Studio, and CLI surfaces
- implemented as trusted workspace packages

Examples:

- Contact Form
- Analytics
- Newsletter
- Table Booking

### `external_embed`

Curated third-party provider integrations that mostly render frontend snippets or embeds.

Characteristics:

- no arbitrary backend code required
- manifest-driven setup UI
- structured snippet generation
- validation, preview guidance, and publish checks
- may be installable from external repos later, but only at build/install time

Examples:

- Calendly / Cal.com
- Google Maps
- Typeform / Tally / Jotform
- HubSpot forms / chat
- Stripe / Lemon Squeezy / Gumroad buy buttons
- Plausible / GA / Meta Pixel
- review widgets

### `connected`

Later phase for integrations that need real backend secrets or API flows.

Characteristics:

- explicit backend adapter contract
- auth/API/secrets policy
- likely OAuth, webhooks, or signed requests

Examples:

- CRM sync
- advanced payment flows
- scheduling APIs beyond a simple embed
- support/helpdesk integrations

## Public Contract Split

The SDK should distinguish two different concepts:

1. Public authoring contract  
   What a plugin contributes conceptually.

2. Internal bundle/install contract  
   How a Vivd deployment includes and wires installed plugin packages.

Recommendation:

- keep the public manifest and contribution types in `@vivd/plugin-sdk`
- move the current `surfaceExports`-style install plumbing behind an internal bundle contract
- treat `plugins/installed` as the place that owns bundle composition and registry generation

### Naming cleanup

Recommended direction:

- `PluginPackageManifest` becomes the public author-facing manifest
- `PluginPackageInstallDescriptor` is renamed to something internal such as `PluginBundleEntry`
- `surfaceExports` stops being treated as part of the conceptual SDK story

## Proposed SDK Shape

### Shared base

```ts
export type PluginKind = "native" | "external_embed" | "connected";

export interface PluginCatalogMetadata {
  pluginId: string;
  kind: PluginKind;
  name: string;
  description: string;
  category: "forms" | "marketing" | "commerce" | "utility";
  version: number;
  sortOrder: number;
  icon?: string;
  keywords?: string[];
}

export interface PluginSetupGuide {
  summary: string;
  automatedSetup: "none" | "partial" | "full";
  instructions?: string[];
  docsUrl?: string;
}

export interface PluginPreviewSupport {
  mode: "native" | "limited" | "none";
  notes?: string;
}

export interface PluginPublishCheckDefinition {
  checkId: string;
  title: string;
  severity: "warning" | "error";
  description: string;
}

export interface BasePluginManifest {
  manifestVersion: 2;
  catalog: PluginCatalogMetadata;
  setup: PluginSetupGuide;
  sharedProjectUi?: SharedProjectPluginUiDefinition;
  previewSupport?: PluginPreviewSupport;
  publishChecks?: PluginPublishCheckDefinition[];
}
```

### Native plugin contract

```ts
export interface NativePluginBackendContribution<
  TPluginId extends string = string,
  TContext = unknown,
  THooks = unknown,
> {
  createContribution(context: TContext): {
    module: PluginModule<TPluginId>;
    publicRoutes?: PublicPluginRouteDefinition<TContext>[];
    hooks?: THooks;
  };
}

export interface NativePluginManifest<
  TPluginId extends string = string,
  TFrontend = unknown,
  TBackendContext = unknown,
  THooks = unknown,
> extends BasePluginManifest {
  catalog: PluginCatalogMetadata & { kind: "native"; pluginId: TPluginId };
  native: {
    cli?: PluginCliModule;
    frontend?: TFrontend;
    backend?: NativePluginBackendContribution<TPluginId, TBackendContext, THooks>;
  };
}
```

### External embed contract

```ts
export type ExternalEmbedRenderMode =
  | "iframe"
  | "script"
  | "html"
  | "head_tag"
  | "body_tag"
  | "link";

export interface ExternalEmbedProviderDefinition {
  provider: string;
  websiteUrl?: string;
  docsUrl?: string;
}

export interface ExternalEmbedPlacementDefinition {
  targets: ("page_body" | "page_head" | "layout_head" | "layout_body")[];
  preferredTarget?: string;
}

export interface ExternalEmbedSecurityPolicy {
  consentCategory?: "analytics" | "marketing" | "functional";
  requiresSecrets: boolean;
  requiresBackend: boolean;
  allowedHosts?: string[];
  cspNotes?: string[];
}

export interface ExternalEmbedManifest extends BasePluginManifest {
  catalog: PluginCatalogMetadata & { kind: "external_embed" };
  externalEmbed: {
    provider: ExternalEmbedProviderDefinition;
    renderMode: ExternalEmbedRenderMode;
    placement: ExternalEmbedPlacementDefinition;
    inputSchema: unknown;
    validationRules?: string[];
    snippetTemplates: {
      html?: string;
      astro?: string;
    };
    security: ExternalEmbedSecurityPolicy;
  };
}
```

### Connected contract

```ts
export interface ConnectedPluginManifest extends BasePluginManifest {
  catalog: PluginCatalogMetadata & { kind: "connected" };
  connected: {
    authMode: "oauth" | "api_key" | "webhook" | "custom";
    requiresBackend: true;
    cli?: PluginCliModule;
    frontend?: unknown;
    backend?: NativePluginBackendContribution;
  };
}
```

### Union

```ts
export type PluginManifest =
  | NativePluginManifest
  | ExternalEmbedManifest
  | ConnectedPluginManifest;
```

## What This Improves

### Internal readability

A reader should be able to open one manifest and understand:

- what kind of plugin this is
- what the user sees in the catalog
- how setup works
- what runtime surfaces it contributes
- what preview/publish constraints apply

That is cleaner than today’s split between:

- manifest
- install descriptor
- generated surface registries
- backend host adapters

The host adapters still exist, but they become an implementation detail of native plugins rather than the primary explanation of what a plugin is.

### Third-party embed support

This model gives external providers a first-class place in the platform without pretending they are native server plugins.

That enables:

- provider cards in the plugin catalog
- structured setup forms
- generated snippets for HTML and Astro
- preview warnings and fallback messaging
- publish-time checks for consent, CSP, missing config, or unsupported placement
- a future assistant UI that can show which providers are supported and whether setup is automatic, guided, or manual

## What The Current Code Already Covers

The current platform already covers some useful foundations:

- generic plugin catalog/info/config/action/read transport
- generic frontend plugin-page composition
- generic CLI plugin help/rendering
- one installed-plugin bundle path

That is enough for internal native plugins.

It is not enough for `external_embed` yet because the SDK does not currently model:

- plugin kind
- provider identity
- render mode
- placement
- consent/security policy
- preview support
- publish checks
- guided/manual setup capability

## Recommended Catalog UX

The control-plane plugin catalog should eventually show:

- plugin kind: native / embed / connected
- provider name
- setup level: automated / guided / manual
- preview support
- whether backend or secrets are required

For embed providers, the setup UI should prefer:

- a structured form
- generated snippet preview
- copy/apply actions
- validation feedback
- concise docs/instructions

The assistant UI can then safely answer:

- which providers are supported
- what setup path exists
- whether Vivd can apply the integration automatically
- what still needs manual provider-side setup

## Curated External Embed MVP

Recommended first curated providers:

- Calendly
- Cal.com
- Google Maps
- Typeform
- Tally
- HubSpot form embed
- HubSpot chat embed
- Plausible
- Google Analytics
- Meta Pixel
- Stripe buy button
- Lemon Squeezy buy button
- Gumroad buy button

Why these first:

- mostly embed/snippet based
- easy to explain in a structured setup UI
- common on brochure, lead-gen, and simple commerce sites

## Migration Plan

### Phase 1: Clean up SDK naming and boundaries

- keep current behavior
- introduce `PluginKind`
- separate public manifest types from internal bundle/install types
- stop treating `surfaceExports` as the public mental model
- Started 2026-04-16: `PluginKind` is now in the real SDK, the internal bundle/install descriptor has a clearer `PluginBundleEntry` name with compatibility aliases left in place, and the installed-plugin composition path still works without behavior changes.

### Phase 2: Introduce manifest v2

- add discriminated `native` / `external_embed` / `connected` manifests
- keep compatibility wrappers for current native plugins
- keep `plugins/installed` generation working during migration
- Started 2026-04-16: first-party native manifests now use `manifestVersion: 2` plus explicit `kind`, setup, and preview metadata scaffolding, while backend catalog entries also surface plugin `kind`.

### Phase 3: Convert first-party native plugins

- move current native plugin manifests to the v2 shape
- keep backend host adapters but hide them behind the native contribution contract
- keep frontend/CLI/studio surfaces generic

### Phase 4: Add curated `external_embed` support

- build provider-driven setup UI
- add snippet generation and validation
- add preview and publish checks
- ship curated providers only

### Phase 5: Optional external distribution

- allow provider packs or plugins from external repos at build/install time
- version-pin them
- validate compatibility during install
- do not fetch and execute arbitrary code at runtime

### Phase 6: Add selected `connected` plugins

- define secret/auth policy
- add backend adapter contracts
- keep this list small and intentional

## Exit Criteria

This plan is complete when:

- internal native plugins read cleanly from one manifest model
- `external_embed` is a first-class supported kind in the real SDK, not only in docs
- the plugin catalog can describe supported third-party providers clearly
- guided embed setup exists without arbitrary runtime code execution
- install/bundle plumbing is clearly separate from the public authoring contract
