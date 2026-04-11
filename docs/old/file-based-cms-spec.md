# File-Based CMS Spec

> Note: this document captures the earlier YAML-first CMS direction. For Astro-backed projects, the current active direction has shifted to Astro-native Content Collections in [`docs/astro-content-collections-plan.md`](./astro-content-collections-plan.md).

Status: Draft  
Last updated: 2026-04-07

This document is a fresh planning pass for Vivd CMS and supersedes the earlier DB-first/CLI-first leaning in `docs/headless-cms-agent-plan.md`.

## Summary

Vivd should treat CMS content for build-backed projects as project-owned files under a canonical `src/content/` directory.

The source of truth should be:

- schema files in the repo
- entry files in the repo
- media files in the repo

Studio should render a structured editor from those schemas, the agent should be allowed to edit those files directly, and the `vivd` CLI should mainly validate, scaffold, and generate derived build/runtime artifacts.

For Astro projects, the recommended render/build foundation is Astro Content Collections plus a thin Vivd adapter layer. That gives us an official, portable, public build-time content system instead of inventing a Vivd-only runtime dependency.

## Why This Direction

This direction fits the product constraints better than a control-plane CMS:

- the project remains self-contained and Git-friendly
- local checkout on another machine still works with `npm install` and normal build tooling
- the agent can inspect and edit content without going through a proprietary platform API
- Studio can render a schema-driven UI from the same files the build uses
- preview/build can use the exact same content source instead of syncing from a separate DB

## Goals

- Put CMS source of truth in project files, not in Vivd platform storage.
- Support multiple collections with different schemas.
- Support localized content fields.
- Support file and image attachments, including PDFs and similar documents.
- Support active/inactive entry states so content can be hidden without deletion.
- Make the content easy for agents to read, create, and edit directly.
- Give Studio users a structured editor that is derived from the same schemas.
- Make preview and build consume the same normalized content contract.
- Keep the solution portable so a checked-out project runs outside the Vivd platform.
- Leave room for singleton, page-backed, reference-heavy, and richer asset workflows after the first release without having to replace the core file contract.

## V1 Scope

V1 should start with collections.

Required in v1:

- multiple collection models with different schemas
- schema-driven Studio UI for browsing and editing collection entries
- automatic field rendering in Studio from the active collection schema, so the same editor surface can adapt to different collection types without custom per-model UI
- localized text fields inside collection entries where needed
- image and document/file fields inside collection entries where needed
- active/inactive entry states
- CLI validation, status, and scaffolding for the collection-first contract
- Astro adapter/build integration for collection content
- Astro starters and scratch-generated Astro projects should be able to include the default CMS folder structure from day one, even if no meaningful collections have been added yet

Explicitly out of scope for v1:

- singleton model support as a required shipped feature
- page-backed model support as a required shipped feature
- full schema-editing UI for non-technical users
- broad model-specific UI beyond what the first collection workflows need

## Non-Goals

- Do not make the control-plane DB the canonical CMS source of truth.
- Do not make the `vivd` CLI the only way to mutate content.
- Do not require a Vivd-private runtime package that only exists inside the platform.
- Do not model the CMS as an optional Vivd plugin.
- Do not build a full human-facing schema designer in v1.
- Do not solve every framework at once; v1 should focus on Astro/build-backed projects.
- Do not promise fully generic visual page-building from schemas alone.

## Product Requirements

### Functional

- A project can define any number of collection models.
- Each model has its own schema and its own storage path.
- Entries support primitive fields, nested objects, arrays, enums, references, rich text, and assets.
- Fields can be localized per configured locale.
- Entries can be marked active or inactive.
- Studio can list entries, filter them, show validation status, and edit them with schema-aware controls.
- The agent can create or edit schema and entry files directly.
- Validation can be run locally and inside Studio through the CLI.
- Build and preview can turn content files into objects that page code can import/query.

The broader architecture should still leave room for later singleton and page-backed model kinds without forcing a contract reset.

The Studio editor contract should be schema-rendered rather than hand-authored per collection type. Adding or changing a collection schema should be enough for the UI to render the corresponding editing controls, subject to the supported field types of the current release.

The CMS should be available by default in Astro-backed Vivd projects, but usage should stay selective. The product should not force all content into collection models; collection-backed CMS content is for domains where structured, repeatable, or user-managed data adds real value.

### Non-Functional

- Content edits should produce readable Git diffs.
- File layout should be stable and deterministic.
- Validation errors should be actionable and path-specific.
- The solution should work without Vivd network services once the repo is checked out.
- Generated artifacts should be reproducible and disposable.

## Recommended External Foundation

### Recommended

Use Astro Content Collections as the build/render integration layer for Astro projects.

Why:

- it is an official Astro feature
- it already supports schema validation and typed content access
- it supports Markdown, JSON, and YAML content
- it supports custom loaders, which gives us a clean translation layer from a Vivd file layout into Astro collections

Vivd should add only a thin adapter on top:

- load the file-based CMS contract from `src/content/`
- validate and normalize it
- expose generated helpers/runtime files for project code

### Not Recommended

Do not add a separate CMS product as the foundation for v1.

Reasons:

- Studio should own the editing UI
- the agent should operate directly on a simple repo file contract
- preview/build should depend on Astro-native content loading plus a thin Vivd adapter, not on another CMS runtime/admin layer

## Core Decision

The CMS should be a core Vivd feature, not a plugin.

Why:

- it defines project source-of-truth content
- it affects preview/build behavior directly
- it must be available as part of the standard Studio editing surface
- it is more like pages/assets/content structure than an optional project capability

Canonical CMS content should live in `src/content/` for Astro-backed projects.

Recommended top-level structure:

```text
src/
  content/
    vivd.content.yaml
    models/
      products.yaml
      categories.yaml
    products/
      alpine-boot.yaml
      alpine-boot.description.en.md
      alpine-boot.description.de.md
    categories/
      winter-boots.yaml
    media/
      products/
        alpine-boot/
          hero.jpg
          datasheet-en.pdf
          datasheet-de.pdf
```

Derived adapter files should live outside the canonical content tree but still inside the project repository, for example:

```text
src/generated/vivd/
  cms-runtime.generated.ts
  cms-helpers.generated.ts
src/pages/media/
  [...path].js
```

Rule:

- `src/content/` is canonical and may be edited by humans, the agent, and Studio UI
- `src/generated/vivd/*.generated.*` is generated and must not be hand-edited
- `.vivd/` stays reserved for ephemeral Studio working state and must not be part of the Astro runtime contract

Future model kinds such as `singletons/` or `pages/` can be added later without changing the collection-first v1 contract.

## Starter Integration

Astro starters, project templates, and scratch-generated Astro projects should be able to scaffold the CMS structure by default.

Recommended default scaffold:

- `src/content/vivd.content.yaml`
- `src/content/models/`
- `src/content/media/`

The default scaffold does not need to ship real business collections in every project. An empty or minimal ready-to-use structure is enough as long as:

- the agent can discover that CMS content belongs there
- Studio can detect that the project supports the CMS contract
- later collection models can be added without restructuring the project

## When To Use CMS

The CMS should be the default available content system in Astro-backed Vivd projects, but not every piece of site content needs to be modeled in it.

Use collection-backed CMS content when the content is:

- repeatable across many entries
- structured enough to benefit from schema validation
- likely to be edited by non-technical users in Studio
- likely to be listed, filtered, reordered, localized, or rendered in multiple places

Good v1 examples:

- product catalogs
- blog/article listings
- team directories
- testimonials
- downloads/resources libraries
- events or case studies

Do not force collection-backed CMS modeling by default for:

- one-off layout wrappers
- purely presentational component structure
- small static marketing copy that is tightly coupled to a single page section and not expected to be managed as data

The agent instructions should steer toward that same rule: use the CMS for structured, repeatable, user-managed content, and keep page/component code for one-off presentational content unless the user or project structure clearly calls for a CMS model.

## File Contract

### Root Config

`src/content/vivd.content.yaml` should declare global CMS configuration:

```yaml
version: 1
defaultLocale: en
locales:
  - en
  - de
models:
  - key: products
    kind: collection
    schema: ./models/products.yaml
  - key: categories
    kind: collection
    schema: ./models/categories.yaml
```

V1 only requires `kind: collection`.

Later phases may extend the same root config to additional model kinds such as:

```yaml
  - key: site
    kind: singleton
    schema: ./models/site.yaml
  - key: pages
    kind: page
    schema: ./models/pages.yaml
```

### Model Schema

Each model schema should be declarative YAML, not arbitrary code.

Example:

```yaml
label: Products
storage:
  path: ./products
  entryFormat: file
display:
  primaryField: name
route:
  detail: /products/[slug]
entry:
  statusField: status
  fields:
    slug:
      type: slug
      required: true
    status:
      type: enum
      options: [active, inactive]
      default: active
    sku:
      type: string
      required: true
    name:
      type: string
      localized: true
      required: true
    category:
      type: enum
      options: [boots, accessories]
    description:
      type: richText
      localized: true
      storage: sidecar-markdown
    attributes:
      type: list
      item:
        type: object
        fields:
          key:
            type: string
            required: true
          value:
            type: string
            localized: true
    documents:
      type: assetList
      accepts:
        - application/pdf
    heroImage:
      type: asset
      accepts:
        - image/*
```

### Entry Format

The default scaffold should use flat file entries under `src/content/<collection-key>/`.
Directory-style entries should still be supported when the schema uses `entryFormat: directory`.

Example:

```yaml
# src/content/products/alpine-boot.yaml
slug: alpine-boot
status: active
sku: BOOT-001
name:
  en: Alpine Boot
  de: Alpine-Stiefel
category: boots
description:
  en: ./alpine-boot.description.en.md
  de: ./alpine-boot.description.de.md
attributes:
  - key: material
    value:
      en: Leather
      de: Leder
documents:
  - path: ../media/products/alpine-boot/datasheet-en.pdf
    label:
      en: Datasheet
      de: Datenblatt
    locale: en
heroImage:
  path: ../media/products/alpine-boot/hero.jpg
  alt:
    en: Alpine boot in profile view
    de: Alpine-Stiefel in Seitenansicht
```

Rich text fields stored as `sidecar-markdown` should reference sibling Markdown files. That keeps long copy readable and keeps YAML diffs small.

## Standard System Fields

Every model should support the following standard concepts even if the exact field names stay configurable:

- stable entry key
- slug when the model participates in URLs
- active/inactive status
- sort order when relevant
- created/updated timestamps in generated metadata, not necessarily in source files

The Studio UI and generated runtime helpers should understand these concepts consistently.

## Supported Field Types In V1

- `string`
- `text`
- `richText`
- `number`
- `boolean`
- `date`
- `datetime`
- `enum`
- `object`
- `list`
- `reference`
- `asset`
- `assetList`
- `slug`

Rules:

- `localized: true` should be supported for `string`, `text`, and `richText` in v1
- `asset` and `assetList` should support files beyond images
- `reference` should point to another collection entry by model key plus entry key

## Media And File Attachments

Binary assets should live under `src/content/media/`.

Asset fields should reference those files by relative path, and validation should verify:

- the file exists
- the file matches allowed extensions or mime expectations
- the file is inside the allowed content/media roots

We should treat PDFs, brochures, menus, price lists, and similar files as first-class CMS assets, not as an afterthought.

## Astro Asset Strategy

For Astro-backed Vivd projects, `src/content/media/` should be the canonical source of truth for Vivd-managed images and documents.

Rules:

- use `src/content/media/` as the shared backing store for CMS asset fields, content-focused media browsing, and Astro-first asset workflows in Studio
- reserve `public/` for passthrough assets that intentionally need stable raw URLs and no Vivd/CMS ownership, such as favicons, manifest icons, `robots.txt`, verification files, or other framework-public files
- do not create a second long-lived user-managed image library under `public/images/` for Astro projects by default
- keep `src/content/media/` human-editable and repo-owned; generated/runtime copies belong outside the canonical tree
- Astro page/component code should not point directly at `src/content/media/...` paths in rendered markup; use generated/runtime URLs or approved helpers instead

Recommended folder conventions inside `src/content/media/`:

- `shared/` for reusable site-wide assets
- `pages/<page-key>/` for page-owned assets that are not part of a repeatable collection
- `<collection-key>/<entry-key>/` for collection-owned assets

Runtime/build rule:

- the Astro adapter should expose canonical `src/content/media/` files at one stable runtime URL base such as `/media/...`
- the canonical source remains `src/content/media/`; do not mirror the media tree into a hidden runtime folder just to serve it
- non-image documents such as PDFs should follow the same rule instead of using a separate ad-hoc public-files path

## Localization

CMS localization should be field-based, not entry-duplication-based, in v1.

Rules:

- `defaultLocale` is required
- non-default locales may be required or optional per field later, but v1 can keep them optional
- scalar localized fields are stored inline as locale maps
- localized rich text uses sidecar Markdown files

Important separation:

- `locales/*.json` or `src/locales/*.json` remain the right place for site chrome and UI strings
- `src/content/` is the right place for structured CMS content such as products, services, downloads, bios, and long-form page copy

## Studio UI

Studio should render a structured CMS UI directly from the schema files.

That means the editing surface is generated from the collection schema:

- the UI reads the model definition and renders the matching controls automatically
- different collection types can reuse the same editor shell while showing different fields
- adding a new supported field to a schema should update the editing UI without requiring a bespoke screen for that collection
- unsupported field types should fail clearly in validation and in the Studio UI instead of silently disappearing

Recommended first UI surface:

- left sidebar with models
- model view with entry list, status, locale completeness, and validation summary
- entry editor with schema-driven controls
- asset picker/uploader rooted in `src/content/media/`
- rich text editor for Markdown-backed fields
- save action that writes the canonical files back into the project workspace

V1 recommendation:

- the first shipped UI should be collection-focused
- users edit entries in Studio UI
- schema files are still mainly agent/developer-authored
- schema editing UI can come later
- singleton-specific and page-specific editing surfaces can come later on the same foundation

## Agent Workflow

The agent should be allowed to edit the canonical files directly.

Agent instructions should say:

- treat `src/content/` as the CMS source of truth when `src/content/vivd.content.yaml` exists
- do not hand-edit `src/generated/vivd/*.generated.*`
- create or update models in `src/content/models/*.yaml`
- prefer collection entries under `src/content/<collection-key>/` unless the schema already uses a different `storage.path`
- place attachments in `src/content/media/`
- run `vivd cms validate` after changing schema or entries
- use generated runtime helpers or approved render helpers instead of inventing raw file-system reads in page code

## Astro Asset Migration Plan

The current repo still has Astro-facing asset flows that prefer `public/images/`. That should be treated as transitional compatibility, not the long-term convention.

Phase 1: lock the canonical source decision

- `src/content/media/` is the only canonical Vivd-managed asset root for Astro projects
- `public/images/` remains readable during migration, but new Astro-first CMS/content flows should stop treating it as the primary library

Phase 2: align Studio surfaces on one library

- keep the CMS picker rooted in `src/content/media/`
- make the Astro asset explorer/gallery default to `src/content/media/` instead of `public/images/`
- make AI image create/edit flows for Astro default to `src/content/media/`
- make the content tab and asset/gallery surfaces read from the same underlying media tree so replacements, previews, and metadata all target one source
- keep `.vivd/uploads/` and `.vivd/dropped-images/` as temporary working storage only

Phase 3: add an Astro runtime adapter for canonical media

- generate project-local helper/runtime files under `src/generated/vivd/`
- expose those files to preview/build/publish under a stable runtime URL base such as `/media/...`
- serve canonical `src/content/media/` directly through that runtime path instead of copying it into `.vivd/`
- provide a small approved helper layer for Astro code and generated data so pages can resolve CMS/media assets without hardcoding source-tree paths
- make image and document assets follow the same adapter path

Phase 4: fix page-level replacement flows

- preview drag/drop and in-page image replacement should stop assuming every Astro image is a `public/` URL rewrite
- when an image comes from a CMS asset field, replacement should edit the CMS field value, not only the `.astro` source string
- when an image is page-owned but not CMS-backed, Studio should still store the chosen file under `src/content/media/pages/...` and rewrite the page to the adapter/runtime URL instead of a raw source-tree path

Phase 5: compatibility and cleanup

- keep short-term compatibility for existing `public/images/` references in older projects
- add an explicit migration path later, such as a Studio action or CLI command, to move/import `public/images/` assets into `src/content/media/` and rewrite references
- once the adapter and migration tooling are stable, stop generating new Astro assets into `public/images/` by default

This keeps the agent surface simple and Git-friendly.

## CLI Role

The CLI should support validation and scaffolding, but it should not become the only authoring surface.

Recommended minimum commands:

- `vivd cms validate`
- `vivd cms scaffold model <key> --kind <collection>`
- `vivd cms scaffold entry <model-key> <entry-key>`
- `vivd cms build-artifacts`
- `vivd cms status --json`

The validation command should check:

- root config validity
- schema validity
- entry validity
- reference integrity
- asset existence and file-type constraints
- duplicate slugs and route collisions
- generated artifact freshness

## Rendering And Translation Layer

There must be a clear translation layer between raw content files and page code.

### Astro V1 Recommendation

For Astro projects:

1. Vivd reads and validates `src/content/`.
2. Vivd generates project-local adapter files into `src/generated/vivd/`.
3. Astro serves canonical `src/content/media/` files through a stable `/media/...` route.
4. Page code imports typed helpers instead of parsing YAML directly.

Recommended runtime/helper surface:

- `getCmsCollection(modelKey, options?)`
- `getCmsEntry(modelKey, entryKey)`
- `resolveCmsAsset(assetRef)`

Default behavior:

- inactive entries are excluded from public/rendered queries unless explicitly requested
- generated metadata includes model labels, field info, and validation state where useful

### Concrete Astro Adapter Design

The Astro adapter should be a generated bridge, not a second hand-authored source of truth.

Recommended generated file layout:

```text
src/
  generated/
    vivd/
      cms-runtime.generated.ts
      cms-helpers.generated.ts
  pages/
    media/
      [...path].js
```

Responsibilities:

- `src/generated/vivd/cms-runtime.generated.ts`
  - generated from canonical `src/content/vivd.content.yaml`, `src/content/models/*.yaml`, and collection entry files
  - contains the normalized runtime snapshot and helper functions for collection/entry/asset lookup
  - must be deterministic so unchanged content does not dirty the repo on rebuild
- `src/generated/vivd/cms-helpers.generated.ts`
  - generated typed helper layer for Astro page code
  - wraps the generated runtime snapshot and normalizes asset convenience helpers such as `/media/...` URL resolution
- `src/pages/media/[...path].js`
  - stable project-local route scaffold for Astro
  - serves canonical `src/content/media/` files at `/media/...`
  - should not depend on a hidden `.vivd/content/media` mirror

Where the generator lives:

- the generator implementation may live in Vivd tooling such as `@vivd/shared/cms`, Studio, or the `vivd` CLI
- the generated runtime contract must live inside the project under `src/generated/vivd/`
- a cloned project should run with normal Astro tooling against project-local files, not by importing ignored `.vivd/content` runtime code

Recommended generation lifecycle:

- `vivd cms validate`
  - validates the canonical `src/content/` files
  - may optionally report whether generated adapter artifacts are stale
- `vivd cms build-artifacts`
  - validates canonical content
  - regenerates `src/generated/vivd/cms-runtime.generated.ts`
  - regenerates `src/generated/vivd/cms-helpers.generated.ts`
  - ensures `src/pages/media/[...path].js` exists for Astro projects if missing
  - removes stale legacy `.vivd/content/` snapshots if present
- Studio save/refresh in Astro projects
  - should run the same artifact step after CMS mutations
- Astro preview/build
  - should depend on the same project-local generated files instead of hidden `.vivd` runtime state

Important nuance:

- entry-content changes do not conceptually require a new schema wrapper, but they do require refreshed generated runtime/helper files
- for simplicity, `vivd cms build-artifacts` may regenerate the generated Astro files on every CMS refresh even if only entry values changed
- the generated Astro adapter files should only change materially when the canonical content changes

### Astro Adapter Mapping Rules

The Astro adapter should map Vivd model schemas into Zod/Astro collections like this:

- `string`, `text`, `slug`
  - `z.string()`
- `number`
  - `z.number()`
- `boolean`
  - `z.boolean()`
- `date`, `datetime`
  - `z.string()` in v1 to avoid timezone/coercion surprises between source YAML and runtime
- `enum`
  - `z.enum([...])` when options are present
- `object`
  - recursive `z.object(...)`
- `list`
  - recursive `z.array(...)`
- `localized: true`
  - `z.object({ [defaultLocale]: baseSchema, [otherLocale]: baseSchema.optional() })`
  - v1 keeps non-default locales optional unless the Vivd schema later adds stricter per-locale requirements
- `richText` with `storage: sidecar-markdown`
  - source YAML stores relative sidecar paths
  - the Vivd build step resolves those files and the Astro loader exposes markdown strings in the final collection entry shape
  - generated metadata may preserve the original sidecar file path under a private `_vivd` metadata key when useful for Studio/debugging
- `reference`
  - source accepts `"model:entry"` or `{ model, entry }`
  - normalized loader output should expose `{ model, entry, id }`
  - generated helper functions should resolve references to actual entries instead of asking page code to parse the string form manually
- `asset`
  - normalized loader output should expose one consistent object shape such as:
    - `path`: canonical source-relative path
    - `url`: stable runtime URL such as `/media/...`
    - `mimeType`
    - image metadata when available
    - label/alt/localized metadata when present in source
- `assetList`
  - array of that same normalized asset object shape

### Astro Query Helper Rules

The generated Astro helper layer should be the default page-facing surface.

Recommended helpers:

- `getCmsCollection(modelKey, options?)`
- `getCmsEntry(modelKey, entryKey, options?)`
- `resolveCmsAsset(assetRef)`
- `resolveCmsReference(referenceRef, options?)`

Recommended behavior:

- call through to `astro:content` under the hood
- filter inactive entries by default
- apply schema-defined sort ordering consistently
- keep raw Astro collection access available for advanced use, but steer agent/project code toward the helpers

This keeps `astro:content` as the framework integration layer while preserving Vivd-specific semantics in one shared adapter instead of duplicating them across page files.

### Why A Translation Layer Is Required

The raw file layout is optimized for authoring and structured editing.

The runtime contract should instead be optimized for:

- predictable imports
- stable object shapes
- typed access in Astro code
- filtering active content
- resolving asset URLs consistently

Those are different concerns, so the translation layer should be explicit.

## Build And Preview Integration

Build-backed preview and publish should run the same CMS preparation steps:

1. validate canonical content
2. generate normalized artifacts
3. build the project

Implications:

- broken content should fail build with clear diagnostics
- preview should surface validation errors inside Studio
- local checkout should be able to run the same steps without platform services

Recommended hook points:

- prebuild in Astro projects
- dedicated builder runtime before `astro build`
- Studio preview refresh after content save

## Active And Inactive Content

Entries should support a standard active/inactive state.

Rules:

- inactive entries remain editable in Studio
- inactive entries are visible in entry lists with clear UI treatment
- inactive entries are excluded from default public rendering

## References

The file contract and UI architecture should leave room for cross-collection references even if the first shipped collection workflows do not need the full UX on day one.

Collections should be able to reference other collections.

Examples:

- product -> category
- team member -> department
- article -> author

Validation should fail when references point to missing entries.

The Studio UI should render references as structured pickers, not as free-form text fields.

## Versioning And Portability

The file contract should be versioned.

Recommended rule:

- `content/vivd.content.yaml` includes `version: 1`
- future breaking layout or schema changes must bump that version

Portability requirement:

- a checked-out project should build from the repo contents plus normal npm dependencies
- no hidden platform database or private service should be required

## Rejected Directions

### DB-First CMS Source Of Truth

Rejected because it breaks Git portability, complicates preview/build consistency, and weakens direct agent editing.

### CLI-Only CMS Mutation

Rejected because the agent already understands files, direct file edits are simpler to diff/review, and the CLI is better as a validator/scaffolder.

### Vivd-Private Runtime Package Only Available On Platform

Rejected because local checkout must work outside Vivd infrastructure.

### Full Framework-Agnostic V1

Rejected for now. Astro/build-backed projects are the right first target. Other frameworks can get their own project-local adapters later.

## Delivery Plan

### Phase 1

- finalize the collection-first file contract
- implement validator and scaffolder for collection models
- add generated artifact builder for `src/generated/vivd/`

### Phase 2

- add Studio read-only collection browser
- add collection-entry editing UI based on schema
- add asset picker/uploader for collection workflows

### Phase 3

- integrate Astro adapter and typed helpers
- wire preview/build to validate plus generate artifacts
- update agent instructions to use the new contract

### Phase 4

- add singleton/page model support if still desired
- add reference pickers, locale completeness UX, and status filtering polish
- evaluate whether schema-editing UI is worth doing

## Open Questions

- Should `pages` be a distinct model kind, or just a convention over a normal collection plus route metadata?
- How much schema editing should Studio own in v1 vs later?
- Do we want explicit draft scheduling/versioning in v1, or only active/inactive?

## Recommendation

The recommended v1 is:

- file-first source of truth in `src/content/`
- collections-first scope for the first release
- declarative YAML schemas
- entry directories with YAML metadata plus Markdown sidecars for long copy
- repo-owned media files for images and documents
- `src/content/media/` as the canonical Astro asset root, with derived runtime/public copies generated from it instead of a parallel `public/images/` library
- Studio UI rendered from those schemas, starting with collection workflows
- direct agent file edits
- `vivd` CLI for validation/scaffolding
- Astro Content Collections plus a thin adapter as the build/render foundation

That gives Vivd a CMS that is structured, editable, Git-friendly, portable, and aligned with how build-backed projects already work.
