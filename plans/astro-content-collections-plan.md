# Astro Content Collections Plan

## Goal

Use Astro Content Collections as the only supported structured-content source of truth for Astro-backed Vivd projects.

Vivd should not introduce a second repo-visible CMS contract for Astro projects. Studio and the CLI should adapt to Astro's existing content model instead of asking Astro projects to adapt to Vivd-owned YAML schemas.

## Decision Summary

For Astro-backed projects:

- `src/content.config.ts` is the canonical model/schema definition surface.
- Astro collection entry files under `src/content/**` are the canonical structured-content entry files.
- `src/content/media/` is the canonical Vivd-managed local asset root for shared/local site assets.
- `public/` is reserved for passthrough files that intentionally need raw framework-public URLs.
- generated Astro starters should include an Astro-native `src/content.config.ts` from day one, not a Vivd YAML shadow schema
- Vivd may keep an internal adapter layer for Studio/CLI, but that adapter must not become a second project-owned source of truth.

This plan supersedes the earlier YAML-first CMS direction in `plans/file-based-cms-spec.md` for Astro-backed projects.

## Source Of Truth

### Models

The only canonical model definition for Astro projects should be:

- `src/content.config.ts`

That means:

- collections are defined with Astro's own `defineCollection(...)` pattern
- field/schema definitions come from the Astro/Zod schema inside that file
- Vivd should inspect and adapt that schema, not replace it with `src/content/vivd.content.yaml` or `src/content/models/*.yaml`

### Entries

The only canonical collection entry files should be the files Astro expects under `src/content/**`.

Vivd should:

- read them directly
- validate them against the Astro/Zod schema
- edit them in place

Vivd should not generate or require a parallel normalized runtime snapshot of all entries in order for the project to work locally.

### Assets

The canonical asset rules for Astro-backed Vivd projects are:

- `src/content/media/` for Vivd-managed local assets
- `public/` only for passthrough/static-public files

Examples for `public/`:

- favicons
- manifest icons
- `robots.txt`
- verification files
- explicit compatibility cases where a raw public URL is the right answer

## Vivd Adapter Layer

Vivd still needs an internal adapter, but that adapter should live inside Vivd code rather than as a second repo contract.

Recommended ownership:

- internal adapter interface in Vivd code
- first implementation: `AstroCollectionsAdapter`

Its job is to normalize Astro's model into something Studio and the CLI can use consistently.

Responsibilities:

- inspect `src/content.config.ts`
- discover collections and their schemas
- normalize supported Astro/Zod schema shapes into the same field metadata shape the Studio CMS form renderer already consumes
- apply narrow compatibility heuristics where needed so obvious local image fields that are still modeled as plain strings can keep using the richer Studio asset/image UI while projects migrate toward stronger Astro-native image schemas
- list, read, create, update, and delete entries
- resolve asset/media field behavior
- expose a stable Studio/CLI-facing contract

Non-responsibilities:

- replacing Astro's content model
- inventing a second schema format
- requiring a generated runtime snapshot just to make the project work locally

## Image And Media Strategy

### Rendering Rule

To simplify drag/drop and local asset handling, Vivd should push Astro projects toward one rendering convention:

- for local/content-managed images, default to Astro's `Image` component
- use plain `<img>` only for remote URLs, deliberate passthrough/public assets, SVG edge cases, or explicit compatibility reasons

This should become the default guidance in agents, templates, and generated Astro starters.

### Why

This gives Vivd a narrower and more reliable image-editing contract:

- local managed images go through Astro's image pipeline
- content-folder images are first-class
- Studio image-drop handling does not have to support every arbitrary string `src` pattern from day one

### Drag/Drop Scope

Initial supported image-drop targets should be:

- CMS/content-bound image fields
- Astro `Image` usage tied to local/content-managed assets
- deliberate `public/` assets where a raw runtime URL is already the right Astro-native answer

Initial non-goals:

- arbitrary raw `<img src="...">` rewrites across every possible pattern
- inventing default public runtime URLs for `src/content/media/**` when no CMS ownership is available

### Shared Media URLs

If Astro-native entry images and `Image` usage do not fully cover shared gallery-style assets, Vivd may add a very small project-local helper or scaffold for stable `/media/...` exposure.

That should be opt-in rather than part of the default Astro starter.

That helper should stay thin:

- no generated runtime snapshot of all entries/assets
- no hidden `.vivd` runtime dependency
- no second content model

## Studio Scope

### Phase 1

Studio should support:

- collection discovery
- entry browsing
- schema-driven field rendering directly from the normalized `src/content.config.ts` adapter output, with a narrow Studio-side fallback for obvious image-like `string` / `string[]` fields
- collection creation into `src/content.config.ts`
- entry creation/deletion
- entry editing
- asset selection/upload/replacement
- validation against the Astro/Zod schema

Even before full Astro-native writes land, the Studio CMS surface should keep using the structured form UI rather than falling back to a generic parsed-data dump.

### Model Editing

Model editing should stay constrained, but it no longer needs to stay read-only.

Because models live in `src/content.config.ts`, Studio should support:

- collection creation in the supported exported `collections` object shape
- structured editing for the supported normalized field tree
- constrained AST-backed rewrites of the target collection `schema` block only
- source-file open/jump actions as the fallback for unsupported custom TypeScript patterns

Vivd should not attempt to support arbitrary TypeScript metaprogramming in `src/content.config.ts`.

### Preview Save Resolution

Preview text editing and image dropping should not remain a separate source-of-truth path for Astro CMS-backed sites.

The next persistence step should be:

- resolve preview text edits back to the owning CMS entry field when the selected DOM node comes from collection content
- resolve preview image drops back to the owning CMS asset field when the selected image comes from collection content
- fall back to raw Astro/HTML patching only when no CMS field ownership can be resolved confidently, with raw Astro source rewrites narrowed to public-URL-safe cases instead of inventing runtime URLs for `src/content/media/**`

This keeps the page preview useful without letting it silently diverge from the actual entry/model source files.

### Preview Ownership Contract

For collection-bound preview editing, Vivd should not rely on heuristic backtracking as the primary path.

Instead, Astro projects should expose a tiny project-local ownership contract in rendered markup for CMS-bound text and images:

- `data-cms-collection`
- `data-cms-entry`
- `data-cms-field`
- `data-cms-kind`
- optional `data-cms-locale`

Recommended shape:

- keep the helper project-local, for example `src/lib/cmsBindings.ts`
- keep it framework-plain and repo-owned
- avoid a required Vivd-specific runtime package for this

Studio should consume that neutral contract and resolve preview saves back into the owning entry field first.

### Project-Local CMS Toolkit

The low-level `cmsBindings.ts` helper is a useful primitive, but it should not remain the main agent-facing authoring surface forever.

The next ergonomics step should be a small project-local CMS toolkit under something like `src/lib/cms/`:

- keep the low-level binding helper as the primitive
- add clearer semantic wrappers such as `CmsText` and `CmsImage`
- prefer entry-scoped helpers for repeated collection card/list markup
- keep the toolkit local to the project first, then promote it to a package only if the surface stabilizes and real reuse pressure appears

This should stay neutral and repo-owned:

- do not introduce a required Vivd runtime package just to make CMS preview save work
- do not create one wrapper per raw HTML tag such as `VivdParagraph` or `VivdSpan`
- do not try to make field ownership fully implicit at runtime

The goal is to make the right binding path obvious to agents and project authors without hiding the underlying CMS ownership contract.

### Localization Split

Localization should keep two distinct source-of-truth lanes:

- localized collection content stays in Astro entry files under `src/content/**`
- global locale-dictionary UI strings stay in `src/locales/*.json`

Recommended authoring contract:

- use `CmsText` with a `locale` prop, or the lower-level `data-cms-locale`, for localized collection fields
- use `data-i18n="key"` for locale-dictionary UI copy such as nav labels, generic buttons, placeholders, and other non-entry strings
- do not put `data-i18n` and CMS ownership attributes on the same element

This keeps preview save deterministic:

- CMS-bound text/image edits resolve back into entry files first
- locale-dictionary text edits resolve into `src/locales/*.json`
- raw Astro/HTML patching stays fallback-only

## CLI Scope

The CLI should evolve from the current YAML-first CMS commands toward Astro-native content operations.

Likely direction:

- inspect Astro collections
- validate entries against Astro schema
- scaffold only Astro-native files or helpers when needed, for example an empty `src/content.config.ts` in starters or a local `cmsBindings.ts` helper

The CLI should stop implying that Astro projects need Vivd-owned YAML schema files to participate in Studio CMS flows.

## Refactor Plan

### 1. Introduce a small internal content-system interface

Define a Vivd-internal abstraction for Studio and CLI content work, with Astro as the first implementation.

Suggested capabilities:

- inspect collections
- inspect supported field shapes
- list/get/create/update/delete entries
- resolve asset fields and media roots

### 2. Implement `AstroCollectionsAdapter`

The first and only supported structured-content adapter should read:

- `src/content.config.ts`
- Astro collection entry files under `src/content/**`

This adapter should normalize supported Astro/Zod schema patterns into Vivd UI metadata.

### 3. Switch Studio read path to Astro-native data

Refactor Studio CMS read/discovery to use the Astro adapter instead of the YAML-first shared CMS package.

### 4. Switch Studio entry CRUD to Astro-native files

Refactor creation/edit/delete/reorder flows so they update Astro entry files directly.

### 5. Narrow image/drop behavior around Astro `Image`

Update agent guidance and Studio persistence rules so local/content-managed images default to Astro `Image`.

### 6. Remove the YAML-first Astro path

Deprecate and then remove the Astro-facing assumptions around:

- `src/content/vivd.content.yaml`
- `src/content/models/*.yaml`
- generated runtime snapshots used to make Astro work

## Acceptance Criteria

The pivot is complete when:

- an Astro project can be cloned and run locally without any Vivd-specific generated runtime snapshot of entries
- `src/content.config.ts` is the only model/schema source of truth
- generated Astro starters do not ship `src/content/vivd.content.yaml`, `src/content/models/*.yaml`, or a default `/media/...` compatibility route
- Studio can inspect and edit supported Astro collection entries directly
- local/content-managed images default to Astro `Image`
- drag/drop is scoped to supported Astro-native image patterns instead of broad arbitrary HTML rewriting
- agent instructions and starter templates reflect the Astro-native contract

## Open Questions

- what exact supported subset of Astro/Zod schema patterns should Studio v1 support?
- should Vivd keep any project-local media helper/scaffold for stable shared `/media/...` URLs, or can Astro-native image usage plus limited `public/` coverage handle enough cases?
- should the CLI continue exposing `cms` commands under the same name, or should Astro-native content tooling be surfaced with new command names?
