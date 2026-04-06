# File-Based CMS Spec

Status: Draft  
Last updated: 2026-04-06

This document is a fresh planning pass for Vivd CMS and supersedes the earlier DB-first/CLI-first leaning in `docs/headless-cms-agent-plan.md`.

## Summary

Vivd should treat CMS content for build-backed projects as project-owned files under a canonical `content/` directory.

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

Explicitly out of scope for v1:

- singleton model support as a required shipped feature
- page-backed model support as a required shipped feature
- full schema-editing UI for non-technical users
- broad model-specific UI beyond what the first collection workflows need

## Non-Goals

- Do not make the control-plane DB the canonical CMS source of truth.
- Do not make the `vivd` CLI the only way to mutate content.
- Do not require a Vivd-private runtime package that only exists inside the platform.
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

- load the file-based CMS contract from `content/`
- validate and normalize it
- expose generated helpers/runtime files for project code

### Not Recommended

Do not add a separate CMS product as the foundation for v1.

Reasons:

- Studio should own the editing UI
- the agent should operate directly on a simple repo file contract
- preview/build should depend on Astro-native content loading plus a thin Vivd adapter, not on another CMS runtime/admin layer

## Core Decision

Canonical CMS content lives in a project-root `content/` directory.

Recommended top-level structure:

```text
content/
  vivd.content.yaml
  models/
    products.yaml
    categories.yaml
  collections/
    products/
      alpine-boot/
        index.yaml
        description.en.md
        description.de.md
    categories/
      winter-boots/
        index.yaml
  media/
    products/
      alpine-boot/
        hero.jpg
        datasheet-en.pdf
        datasheet-de.pdf
```

Derived artifacts should live outside the canonical content tree, for example:

```text
.vivd/content/
  manifest.json
  models/*.json
  runtime.mjs
  runtime.d.ts
  media/**
```

Rule:

- `content/` is canonical and may be edited by humans, the agent, and Studio UI
- `.vivd/content/` is generated and must not be hand-edited

Future model kinds such as `singletons/` or `pages/` can be added later without changing the collection-first v1 contract.

## File Contract

### Root Config

`content/vivd.content.yaml` should declare global CMS configuration:

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
  path: ./collections/products
  entryFormat: directory
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

Each entry should live in its own directory when the schema uses `entryFormat: directory`.

Example:

```yaml
# content/collections/products/alpine-boot/index.yaml
slug: alpine-boot
status: active
sku: BOOT-001
name:
  en: Alpine Boot
  de: Alpine-Stiefel
category: boots
description:
  en: ./description.en.md
  de: ./description.de.md
attributes:
  - key: material
    value:
      en: Leather
      de: Leder
documents:
  - path: ../../media/products/alpine-boot/datasheet-en.pdf
    label:
      en: Datasheet
      de: Datenblatt
    locale: en
heroImage:
  path: ../../media/products/alpine-boot/hero.jpg
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

Binary assets should live under `content/media/`.

Asset fields should reference those files by relative path, and validation should verify:

- the file exists
- the file matches allowed extensions or mime expectations
- the file is inside the allowed content/media roots

We should treat PDFs, brochures, menus, price lists, and similar files as first-class CMS assets, not as an afterthought.

## Localization

CMS localization should be field-based, not entry-duplication-based, in v1.

Rules:

- `defaultLocale` is required
- non-default locales may be required or optional per field later, but v1 can keep them optional
- scalar localized fields are stored inline as locale maps
- localized rich text uses sidecar Markdown files

Important separation:

- `locales/*.json` or `src/locales/*.json` remain the right place for site chrome and UI strings
- `content/` is the right place for structured CMS content such as products, services, downloads, bios, and long-form page copy

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
- asset picker/uploader rooted in `content/media/`
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

- treat `content/` as the CMS source of truth when `content/vivd.content.yaml` exists
- do not hand-edit `.vivd/content/`
- create or update models in `content/models/*.yaml`
- create or update collection entries in `content/collections/`
- place attachments in `content/media/`
- run `vivd cms validate` after changing schema or entries
- use generated runtime helpers or approved render helpers instead of inventing raw file-system reads in page code

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

1. Vivd reads and validates `content/`.
2. Vivd generates normalized artifacts into `.vivd/content/`.
3. Astro consumes a thin adapter built on Astro Content Collections or a custom loader.
4. Page code imports typed helpers instead of parsing YAML directly.

Recommended runtime/helper surface:

- `getCmsCollection(modelKey, options?)`
- `getCmsEntry(modelKey, entryKey)`
- `resolveCmsAsset(assetRef)`

Default behavior:

- inactive entries are excluded from public/rendered queries unless explicitly requested
- generated metadata includes model labels, field info, and validation state where useful

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

Rejected for now. Astro/build-backed projects are the right first target. Other frameworks can consume the normalized `.vivd/content/` contract later.

## Delivery Plan

### Phase 1

- finalize the collection-first file contract
- implement validator and scaffolder for collection models
- add generated artifact builder for `.vivd/content/`

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
- Should image assets stay in `content/media/` and be copied into a public/runtime location, or should we add an Astro-specific image pipeline for optimized CMS images?
- Should generated artifacts live in `.vivd/content/` permanently, or should some framework adapters generate into `src/generated/` instead?
- How much schema editing should Studio own in v1 vs later?
- Do we want explicit draft scheduling/versioning in v1, or only active/inactive?

## Recommendation

The recommended v1 is:

- file-first source of truth in `content/`
- collections-first scope for the first release
- declarative YAML schemas
- entry directories with YAML metadata plus Markdown sidecars for long copy
- repo-owned media files for images and documents
- Studio UI rendered from those schemas, starting with collection workflows
- direct agent file edits
- `vivd` CLI for validation/scaffolding
- Astro Content Collections plus a thin adapter as the build/render foundation

That gives Vivd a CMS that is structured, editable, Git-friendly, portable, and aligned with how build-backed projects already work.
