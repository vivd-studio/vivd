# Headless CMS + CLI-First Agent Plan

## Decision Summary

This direction is now explicitly **CLI-first**.

- Start immediately with a `vivd` CLI on the Studio machine.
- The agent can already execute bash, so the CLI becomes the primary structured interface.
- Keep structured CMS data in the **control-plane DB** as the source of truth.
- Keep files/assets in object storage, referenced from CMS entries.
- Treat images and document/file assets such as PDFs as first-class CMS content, not as an afterthought.
- Render sites from a **generated content snapshot** during preview/publish, not from live DB reads by default.
- Put the first CMS UI in the **host app project routes**, embedded into Studio the same way Plugins and Analytics already work.

The CLI should be the first delivery surface, not a later convenience layer.

## Why this direction

Vivd already has:

- a stable control-plane/backend boundary
- Studio-connected auth/runtime env on the machine
- OpenCode tools that are already thin backend-backed transports
- host-app project pages for embedded project workflows (`Plugins`, `Analytics`)

That means the lowest-risk path is:

1. build a discoverable `vivd` CLI first
2. keep CMS business logic in backend services
3. expose the same operations to Studio UI and OpenCode tools
4. materialize site-facing content snapshots at preview/publish time

## Core Architecture

### Source of truth

The canonical structured content should live in the control plane, not in project source files.

That means:

- **logical content schemas** are stored as app data in shared CMS tables
- **entries** are stored as validated structured payloads
- **assets** are stored in object storage with project-scoped references
- the **site artifact** receives a generated snapshot of the current content state

Images and files must be handled as first-class content-linked assets, including common website cases such as:

- hero and gallery images
- logos and team/profile images
- PDFs and downloadable documents
- brochures, menus, price lists, spec sheets, and similar attachments

The agent must never alter the physical platform DB schema. It may only mutate project content models through guarded backend APIs.

### Files in the project workspace

Project files can still contain optional derived bridge/cache material under `.vivd/`, for example:

- `.vivd/content/models.json`
- `.vivd/content/entries/*.json`
- `.vivd/content/README.md`

These are optional and derived. They are not the source of truth.

### Runtime rendering

Published sites should not hit the control-plane DB at runtime by default.

Default flow:

- edit content in control plane
- build preview/publish artifact
- export content snapshot into the build workspace
- render from that snapshot

This keeps sites fast, reproducible, and operationally simple in multi-tenant setups.

## 1. CLI-First Delivery Plan

## CLI goals

The `vivd` CLI should let the agent discover the available surface and perform structured project operations without needing custom tool docs first.

### Command design principles

- Every command group must support `--help`.
- Every command group must support a plain `help` verb.
- Every read command must support `--json`.
- Errors must be explicit and actionable.
- Exit codes must be stable and non-zero on failure.
- Output must be readable for humans by default and deterministic for the agent via `--json`.

### Required discoverability contract

The following commands should work from the start:

- `vivd help`
- `vivd doctor`
- `vivd whoami`
- `vivd project info`
- `vivd plugins help`
- `vivd plugins catalog`
- `vivd plugins info contact`
- `vivd plugins info analytics`
- `vivd cms help`
- `vivd cms models help`
- `vivd cms entries help`

Recommended convenience aliases:

- `vivd help plugins`
- `vivd help cms`
- `vivd help cms models`
- `vivd help cms entries`

### Initial command shape

#### Global

- `vivd help`
- `vivd doctor`
- `vivd whoami`
- `vivd project info`

#### Plugin parity commands

- `vivd plugins catalog`
- `vivd plugins info contact`
- `vivd plugins info analytics`
- `vivd plugins configure contact ...`

These should cover the same surface as the current `vivd_plugins_*` tools first.

#### CMS commands

- `vivd cms models list`
- `vivd cms models show <model-key>`
- `vivd cms models create <model-key>`
- `vivd cms models update <model-key>`
- `vivd cms models validate <model-key>`
- `vivd cms models activate <model-key>`
- `vivd cms entries list <model-key>`
- `vivd cms entries show <model-key> <entry-key>`
- `vivd cms entries create <model-key>`
- `vivd cms entries update <model-key> <entry-key>`
- `vivd cms entries delete <model-key> <entry-key>`
- `vivd cms entries attach <model-key> <entry-key> <field-key> <file>`
- `vivd cms assets list`
- `vivd cms assets show <asset-id>`
- `vivd cms assets upload <file>`
- `vivd cms assets delete <asset-id>`
- `vivd cms render help`
- `vivd cms render show-contract`
- `vivd cms render scaffold <model-key>`
- `vivd cms snapshot export`

The first version does not need the full set on day one, but the plan should target this shape.

### Packaging and install

Recommended packaging:

- create a new workspace package, preferably `packages/cli`
- expose a `bin` named `vivd`
- build it into a compiled JS entrypoint first
- place it on the Studio machine `PATH`

Do **not** overcomplicate the first version with native binary packaging. Studio already runs Node. A built CLI entrypoint is enough to start.

### Studio machine install path

The CLI should be available anywhere the agent runs on the Studio machine.

Recommended install approach:

- build the CLI as part of the Studio/runtime image
- ensure `vivd` is available on `PATH`
- keep its auth/runtime context env-driven, matching the current Studio connected-mode envs

That is better than writing ad-hoc per-project scripts into the workspace.

### Shared runtime/auth client

Do not build a second backend transport stack for the CLI.

The CLI should reuse and consolidate the current connected-runtime path that already exists in:

- `packages/studio/server/opencode/toolModules/runtime.ts`
- `packages/studio/server/lib/connectedBackendAuth.ts`
- `packages/shared/src/config/studioMode.ts`

Recommended move:

- extract a reusable Studio-connected backend client helper
- make both OpenCode tools and the new CLI depend on that helper

This should own:

- env detection
- auth headers
- tRPC query/mutation helpers
- project/org/studio scoping
- uniform error formatting

### Relationship to existing OpenCode tools

The CLI does **not** replace the current tools on day one.

Recommended rollout:

1. Keep the current `vivd_plugins_*` tools working.
2. Add CLI parity for the existing plugin/info surface.
3. Update agent instructions to mention `vivd` as the preferred structured interface.
4. Decide later whether tools should:
   - keep calling the backend client directly, or
   - shell out to `vivd ... --json`

The important part is that CLI and tools share the same backend contracts.

### Injected agent instruction hint

The injected agent instructions should contain a **very short** summary of any CMS models that already exist for the project.

Purpose:

- give the agent quick situational awareness at session start
- avoid forcing a CLI discovery round-trip for the most basic context
- keep the main system prompt small

Rules:

- include only a concise model list or summary
- do **not** inline full field definitions or large schema JSON
- if there are many models, summarize and tell the agent to use the CLI for details
- use the CLI as the expansion path: `vivd cms models list` and `vivd cms models show <model-key>`
- include a short rendering hint that CMS content should be integrated through the Vivd render contract, not by inventing direct backend fetches

Suggested shape:

- `CMS models: downloads (collection, 12 entries), team (singleton), faq (collection).`
- `Use 'vivd cms models list --json' or 'vivd cms models show <model-key> --json' for details.`

If no models exist yet, say that briefly and stop there.

## 2. CMS Integration Into The Control-Plane DB

## Principle

A project's CMS schema is **logical schema data**, not a physical SQL schema.

That means:

- a project schema is stored as rows/config inside shared CMS tables
- the agent changes model definitions through API calls
- the platform DB schema remains stable
- Drizzle migrations remain developer-owned only

## Recommended stable tables

### `project_content_model`

One row per project-scoped collection or singleton.

Suggested responsibilities:

- organization/project scoping
- model key and label
- collection kind (`collection` or `singleton`)
- active version pointer
- status / archive flags

### `project_content_model_version`

Versioned schema definitions for a model.

Suggested responsibilities:

- draft vs active versioning
- field definitions JSON
- UI/editor metadata JSON
- validation summary
- migration notes

### `project_content_entry`

One row per content item.

Suggested responsibilities:

- project/model scoping
- stable entry key or slug
- entry status
- ordering
- values payload JSON
- updated timestamps

### `project_content_entry_revision`

Immutable history for entry changes.

Suggested responsibilities:

- audit trail
- rollback support
- actor/source tracking (`ui`, `cli`, `agent`, `migration`)
- before/after or full snapshot payload

### `project_content_asset`

Asset metadata for files/images attached to content entries.

Suggested responsibilities:

- object storage key
- media metadata
- project/model/entry association
- field binding
- human filename and MIME type
- image dimensions / variants where relevant
- document metadata such as page count when available

### Media support requirements

Media is not just a generic blob attachment layer. The CMS should explicitly support:

- image assets for rendering in pages and collections
- file/document assets for downloads, especially PDFs
- reusable project-scoped assets that can be referenced by multiple entries later
- stable metadata returned to CLI/UI/render pipelines

The first version does not need a full DAM, but it does need a coherent media model.

## Recommended field types for the first version

Keep the first field set intentionally small:

- `text`
- `richtext`
- `number`
- `boolean`
- `date`
- `url`
- `select`
- `image`
- `file`

Only add references/relations after the first content slice is proven.

## Schema change safety

Model changes should be versioned and validated before activation.

Recommended flow:

1. create or edit a **draft** model version
2. validate it against existing entries
3. show breaking issues
4. optionally run a constrained data transform
5. activate the model version

By default, allow:

- adding models
- adding optional fields
- updating labels/help text/editor metadata
- tightening non-breaking validation

Guard or block by default:

- deleting fields with live data
- changing field types
- making optional fields required
- deleting models with entries

## 3. Backend Service + API Plan

## New backend service surface

Add a dedicated service layer, for example:

- `packages/backend/src/services/content/ProjectContentService.ts`

This service should own:

- model creation/update/versioning
- entry CRUD
- asset binding
- validation
- snapshot export
- audit/revision writes

Do not place CMS logic in the CLI or Studio UI.

## Router structure

Recommended backend exposure:

- a normal frontend-facing router, e.g. `packages/backend/src/trpcRouters/content/*`
- a Studio-connected mirror surface added to `packages/backend/src/trpcRouters/studioApi.ts`

Why both:

- frontend project pages should use standard authenticated project-member procedures
- the Studio machine CLI and any OpenCode tools should use the Studio-connected auth path

The payloads and semantics should stay aligned across both surfaces.

## Suggested first operations

### Model operations

- list models
- get model
- create model
- update draft model
- validate draft model
- activate model
- archive model

### Entry operations

- list entries
- get entry
- create entry
- update entry
- delete/archive entry
- reorder entries
- attach/detach asset

### Snapshot operations

- export project content snapshot
- inspect last snapshot metadata

## 4. Studio UI Plan

## Where the CMS UI should live

The first CMS UI should live in the **host app**, not inside the preview iframe DOM.

Recommended first placement:

- add a new project route, e.g. `/vivd-studio/projects/:projectSlug/content`
- implement a new page like `packages/frontend/src/pages/ProjectContent.tsx`
- support `embedded=1`, following the current `ProjectPlugins` and `ProjectAnalytics` pattern
- add a new Studio toolbar action that navigates to that page from inside embedded Studio

This is the correct first home because it:

- matches the existing project-management UX
- reuses auth/routing/forms infrastructure
- avoids coupling the CMS editor to preview DOM internals
- already has an embedded-into-Studio navigation pattern

## Exact Studio insertion points

The new CMS surface should be wired into the same places that already expose Plugins and Analytics.

### Host app routing

Extend:

- `packages/frontend/src/app/router/paths.ts`
- `packages/frontend/src/app/router/routes.tsx`

Add:

- `ROUTES.PROJECT_CONTENT(slug)`
- a `ProjectContentRoute`

### Embedded Studio host header / project actions

Extend:

- `packages/frontend/src/pages/EmbeddedStudio.tsx`

Add a `Content` action to the project actions menu next to `Plugins` and `Analytics`.

### Studio toolbar

Extend:

- `packages/studio/client/src/components/preview/toolbar/hostNavigation.ts`
- `packages/studio/client/src/components/preview/toolbar/StudioToolbar.tsx`

Add a `Content` button next to `Plugins` and `Analytics`, using the same embedded navigation pattern.

## How the CMS page should render

The page should render like a proper CMS surface, not like a raw file explorer.

Recommended first layout:

- **left column**: content models / collections
- **center**: entries list or table for the selected model
- **right drawer or modal**: entry editor or model editor

The CMS UI should also expose a lightweight media workflow:

- upload image/file assets while editing an entry
- pick an existing project asset when appropriate
- preview images inline
- preview/download files such as PDFs

### Primary view: entries first

When users open the page, they should land on **entries**, not schema editing.

That means the default flow is:

1. pick a model
2. see entries
3. add/edit/delete entries

Schema editing should be a secondary explicit action.

### Entry editing

Render entry forms from the active model definition.

Recommended behavior:

- generated form fields by field type
- explicit Save action
- inline validation before submit
- file/image fields use upload + picker UX
- image fields should show thumbnail/alt-text oriented affordances where relevant
- file fields should show filename, type, size, and PDF/document preview/download affordances where possible
- list/table supports quick editing for very simple scalar fields later

### Model/schema editing

Keep schema editing behind an explicit "Edit model" flow.

Recommended behavior:

- open draft model editor
- field list with add/remove/reorder
- preview validation changes
- show breakage before activation
- require explicit activate/apply step

Recommended product scope:

- v1 should focus on **human-editable content entries**
- general human-editable model/schema editing can land in **v2**
- v1 model creation and evolution can stay more controlled through agent/CLI-led flows

## Embedded Studio behavior

The first embedded Studio experience should behave like Plugins/Analytics:

- from Studio toolbar, open the project Content page
- render inside the host shell with `embedded=1`
- keep layout compact and focused

This is enough for the first version.

### Later Studio-native enhancement

After the host-page flow works, consider an in-Studio quick-edit drawer for small content edits.

That would be a second phase, not the starting point.

## 5. Site Rendering Plan

## Default rendering model

Do not make the site fetch live CMS data from the control plane by default.

Default flow:

1. content is edited in control plane
2. preview/publish requests a content snapshot
3. snapshot is written into the build workspace
4. site renders that snapshot

## Recommended render contract

The easiest, most flexible, and most scalable rendering path is:

- control-plane DB as canonical CMS store
- generated local content snapshot inside the project/workspace
- a small Vivd-owned render helper package consumed from project code

Do **not** make the default rendering contract:

- direct runtime reads from the control-plane DB
- ad-hoc fetches to internal CMS APIs from arbitrary page code
- raw JSON parsing scattered across projects

### Recommended package shape

Add a small internal package, for example:

- `@vivd/content`

This package should provide a stable code-facing render API on top of the generated snapshot.

Suggested responsibilities:

- read the generated snapshot
- expose collection/singleton helpers
- resolve assets consistently
- hide snapshot layout details from project code

Suggested API shape:

- `getCollection(modelKey)`
- `getEntry(modelKey, entryKey)`
- `getSingleton(modelKey)`
- `resolveAsset(assetRef)`
- `listAssets(modelKey?)`

Astro-specific helpers can be added if useful, for example:

- `@vivd/content/astro`

### Why this is the preferred path

This gives Vivd the best balance of:

- **ease**: agent and developers work against code helpers, not raw DB/API contracts
- **flexibility**: snapshot format can evolve without rewriting project templates
- **scalability**: preview/publish remain snapshot-based and tenant-safe
- **agent ergonomics**: the agent can use CLI for discovery and code imports for integration

## Agent integration contract

The plan should explicitly tell the agent how CMS data is supposed to be integrated into a page.

The default instruction should be:

- use the CLI to inspect models and entries
- use the Vivd render helper package in project code
- render from the generated snapshot contract
- do **not** invent direct control-plane fetches unless the project explicitly opts into a live mode later

Suggested concise instruction pattern:

- `Use 'vivd cms models list' and 'vivd cms models show <model-key>' to inspect CMS data.`
- `When integrating CMS data into project code, use the Vivd content render contract/helpers rather than calling the control-plane API directly.`
- `If no helper import is present yet, scaffold or add the standard Vivd CMS render helper usage instead of hand-parsing backend responses.`

### Agent-friendly scaffold path

The CLI should help the agent implement rendering, not just inspect data.

Recommended rendering-oriented commands:

- `vivd cms render help`
- `vivd cms render show-contract`
- `vivd cms render scaffold <model-key>`

The scaffold command does not need to fully edit arbitrary projects on day one, but it should at least provide:

- the expected import path
- the expected helper calls
- a minimal Astro example
- a minimal plain HTML / JS example where applicable
- notes on image/file field rendering

## Snapshot shape

The snapshot should be explicit and portable.

Suggested export structure:

- snapshot metadata
- active models
- entries by model
- resolved asset references

Resolved asset references should include enough information for rendering and download UX, for example:

- public or preview-safe asset URL
- MIME type
- filename
- image dimensions when relevant
- file size when relevant

This can be emitted as:

- one consolidated JSON snapshot, or
- one manifest plus per-model files

Recommended first implementation:

- a generated snapshot under a reserved path such as `.vivd/content/`
- a stable helper package API that reads from that location

Project code should depend on the helper contract, not the raw file layout.

## Astro projects

For Astro projects, generate content into a build-friendly location that Astro can import directly.

Examples:

- generated JSON files under a reserved generated directory
- a generated loader/module used by project code
- a small helper import from `@vivd/content` or `@vivd/content/astro`

The key rule is that Astro should consume a generated snapshot, not open a live DB connection.

For image and file fields, the generated snapshot should make it easy to render:

- responsive images or image metadata where available
- document download links and labels
- PDF/document cards, lists, or detail views

Recommended Astro direction:

- keep the agent-facing integration code-based
- have the agent import the standard Vivd helper package
- keep the helper API stable even if the generated snapshot layout evolves

## Plain HTML projects

For plain HTML sites, the first version should stay **de-prioritized and constrained**.

Reasoning:

- a true headless CMS experience on pure no-build plain HTML is awkward if we do not want direct live backend reads
- without a build or regeneration step, plain HTML tends to push us toward client-side fetches or ad-hoc runtime injection
- that is not the clean path this CMS architecture is optimized for

Recommended product stance:

- do **not** optimize v1 around no-build plain HTML CMS rendering
- focus the first-class experience on build-step projects, especially Astro
- if plain HTML is supported in v1 at all, keep it limited to Vivd-owned scaffolded patterns or regeneration flows rather than arbitrary hand-authored integration

Recommended path:

- export generated content JSON
- support a small set of Vivd-owned rendering patterns/components
- have the agent or generator wire those patterns into pages
- prefer a tiny generated or bundled helper script over repeated custom JSON parsing when possible

Do not try to support arbitrary runtime querying from plain HTML in the first version.

## Optional future live mode

If some projects need runtime-fresh data later, add that as an **opt-in** mode.

It should not be the default architecture for preview/publish.

## 6. Most Important Open Implementation Decisions

The overall direction is solid enough to start, but a few contracts should be locked before implementation spreads across backend, CLI, Studio UI, and rendering.

## A. Render contract

### Recommendation

Freeze a small, explicit render contract before building CMS CRUD deeply.

Recommended default:

- generated snapshot under `.vivd/content/`
- small helper package such as `@vivd/content`
- CLI discovery and scaffold commands pointing to that contract

Recommended first snapshot layout:

- `.vivd/content/manifest.json`
- `.vivd/content/models/<model-key>.json`
- `.vivd/content/assets/<asset-id>.json` or asset metadata embedded in model files

Recommended first helper API:

- `getCollection(modelKey)`
- `getSingleton(modelKey)`
- `getEntry(modelKey, entryKey)`
- `resolveAsset(assetRef)`

### Why it matters

If this stays vague, every later layer will drift:

- CLI scaffolds
- agent instructions
- Astro examples
- plain HTML examples
- snapshot export

### Default assumption

Treat the helper package API as the stable contract and the raw snapshot file layout as replaceable internals.

## B. Preview invalidation and refresh

### Recommendation

Start with a simple, explicit refresh path after CMS saves.

Recommended flow:

1. CMS write succeeds in the control plane.
2. Backend increments a project content revision.
3. Active Studio runtime notices or is told about the revision.
4. Studio regenerates `.vivd/content/`.
5. Preview refreshes with a content-revision cache buster.

Recommended first behavior:

- entry and asset changes: debounced refresh after save
- schema/model activation: explicit refresh after apply
- image/file replacement: asset URL cache-busting based on content revision or asset revision

### Why it matters

The product promise is that CMS edits show up in preview quickly. That requires a concrete invalidation story, not just a storage model.

### Default assumption

For v1, prefer a whole-preview refresh after successful save over a more fragile partial hot-update system.

## C. Schema/model versioning rules

### Recommendation

Separate safe entry editing from riskier model evolution.

Recommended model lifecycle:

- one active version
- zero or one draft version
- validate draft against existing entries
- activate only after validation passes

Recommended default policy:

- allow without ceremony:
  - add model
  - add optional field
  - edit labels/help text/display metadata
- require guarded validation/activation:
  - type changes
  - required/optional flips
  - field deletion
  - slug/identity changes

### Why it matters

Without this, “schema editing” becomes dangerous very quickly and will either break content or push the team back toward raw manual edits.

### Default assumption

Schema edits are draft/apply operations; entry edits are normal CRUD.

## D. Media lifecycle

### Recommendation

Treat media as a small, coherent subsystem, not as anonymous uploads.

Recommended first media model:

- stable asset id
- object storage key
- display filename
- MIME type
- size
- image dimensions when relevant
- optional alt text / caption metadata later
- soft-delete / archive instead of immediate hard delete when assets are in use

Recommended first UX:

- upload and attach during entry edit
- choose existing asset for reuse where practical
- image thumbnail preview
- PDF/file preview/download affordances

Recommended first deletion policy:

- block or warn on deletion if an asset is referenced by active content
- prefer replacement or detach over hard delete

### Why it matters

Images and PDFs are not edge cases here. They are central to why users want CMS workflows instead of file surgery.

### Default assumption

Start with project-scoped assets, not global instance-wide media libraries.

## E. Scope of framework support in v1

### Recommendation

Support Astro well first, and keep plain HTML support constrained to Vivd-owned render patterns/scaffolds.

Recommended v1 split:

- Astro: first-class helper-based render integration
- plain HTML: de-prioritized, limited to scaffolded JSON/helper-based render blocks for specific patterns if needed
- everything else: later, once the render contract is stable

### Why it matters

Trying to solve fully generic rendering for every project type too early will slow the whole CMS effort down.

### Default assumption

Astro gets the best experience first; plain HTML gets a limited but solid pattern-based path.

## F. Agent instruction scope

### Recommendation

Keep injected instructions short and operational.

Recommended contents:

- concise existing-model summary
- short render-contract hint
- short CLI discovery reminder

Do not include:

- full schema definitions
- long render examples
- full asset manifests

### Why it matters

The agent needs context, but a bloated prompt will make everything worse.

### Default assumption

Use the prompt only for orientation and rules. Use CLI + code scaffolds for detail.

## Product decisions that still need explicit guidance

Resolved product decisions:

1. v1 should let users edit and change **content entries** directly; general human-editable model/schema editing can be deferred to v2.
2. v1 should not focus on pure no-build plain HTML CMS rendering; Astro/build-step projects are the primary target, with plain HTML kept constrained or deferred.
3. v1 content editing should use **explicit save** rather than autosave.

## 7. Delivery Phases

## Phase 0: CLI foundation

- add `packages/cli`
- expose `vivd`
- extract shared connected backend client
- install CLI on Studio machine
- ship `help`, `doctor`, `whoami`, `project info`
- ship plugin parity commands
- ship initial render-contract discovery commands
- update agent instructions to mention CLI discovery flow
- inject only a concise existing-model summary into agent instructions, with CLI-based expansion for detail

## Phase 1: CMS backend foundation

- add stable CMS tables + Drizzle migration
- add `ProjectContentService`
- add frontend-facing `content` router
- add Studio-facing `studioApi` CMS procedures
- support read-only model/entry inspection from CLI

## Phase 2: CMS write path

- model draft/version flow
- entry CRUD
- asset attachment flow
- revision history
- CLI write commands

## Phase 3: Studio UI

- add `ProjectContent` page
- add embedded mode support
- add `Content` route
- add `Content` toolbar/action entry points
- render entries list + editor
- keep v1 human UI focused on entry editing; defer general human model editor to v2

## Phase 4: Preview/publish rendering

- snapshot export
- add the first Vivd render helper package / render contract
- preview integration
- publish integration
- first supported Astro-first render pattern in sites
- render-scaffold guidance for the agent

## Phase 5: Tool consolidation

- decide whether OpenCode tools stay direct-client based or shell out to `vivd`
- add focused `vivd_cms_*` tools only if they still add value beyond bash + CLI

## 8. Recommended First Vertical Slice

Do not start with a general CMS builder for everything.

Recommended first slice:

- a `downloads` or `documents` collection

Why this is a strong first slice:

- directly addresses the “swap a PDF / small content fix” pain
- tests file attachments
- tests repeated structured entries
- avoids the full complexity of a rich product catalog on day one

Suggested first model:

- `title`
- `description`
- `category`
- `file`
- `thumbnail` or `coverImage`
- `order`

After that works, add a more relational slice like `products`.

## 9. Immediate Next Steps

1. Create the CLI package and shared backend client.
2. Define the first render contract around a small Vivd-owned helper package plus generated `.vivd/content/` snapshot.
3. Mirror existing plugin info/catalog surfaces in the CLI.
4. Add the first CMS tables and read-only CLI inspection commands.
5. Lock the preview refresh/invalidation flow for content saves.
6. Build the v1 entry-editing `ProjectContent` route and Studio toolbar/button wiring.
7. Keep model/schema editing agent/CLI-led first; defer the general human model editor to v2.
8. Land one narrow collection (`downloads`/`documents`) before broadening the field model.

## Current Leaning

The current recommended architecture is:

- **control plane DB** as canonical CMS store
- **`vivd` CLI** as the first-class structured agent interface
- **a small Vivd-owned render helper package** as the standard integration surface inside project code
- **host app embedded pages** as the first Studio UI surface, focused on entry editing in v1
- **generated preview/publish snapshots** as the site rendering mechanism
- **Astro/build-step projects** as the primary rendering target in v1
- optional `.vivd/` bridge files only as derived cache

This fits Vivd's current boundaries and avoids turning either project files or the agent into the primary CMS database.
