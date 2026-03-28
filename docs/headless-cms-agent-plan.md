# Headless CMS + CLI-First Agent Plan

## Decision Summary

This direction is now explicitly **CLI-first**.

- Start immediately with a `vivd` CLI on the Studio machine.
- The agent can already execute bash, so the CLI becomes the primary structured interface.
- Keep structured CMS data in the **control-plane DB** as the source of truth.
- Keep files/assets in object storage, referenced from CMS entries.
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
- list/table supports quick editing for very simple scalar fields later

### Model/schema editing

Keep schema editing behind an explicit "Edit model" flow.

Recommended behavior:

- open draft model editor
- field list with add/remove/reorder
- preview validation changes
- show breakage before activation
- require explicit activate/apply step

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

## Snapshot shape

The snapshot should be explicit and portable.

Suggested export structure:

- snapshot metadata
- active models
- entries by model
- resolved asset references

This can be emitted as:

- one consolidated JSON snapshot, or
- one manifest plus per-model files

## Astro projects

For Astro projects, generate content into a build-friendly location that Astro can import directly.

Examples:

- generated JSON files under a reserved generated directory
- a generated loader/module used by project code

The key rule is that Astro should consume a generated snapshot, not open a live DB connection.

## Plain HTML projects

For plain HTML sites, the first version should stay constrained.

Recommended path:

- export generated content JSON
- support a small set of Vivd-owned rendering patterns/components
- have the agent or generator wire those patterns into pages

Do not try to support arbitrary runtime querying from plain HTML in the first version.

## Optional future live mode

If some projects need runtime-fresh data later, add that as an **opt-in** mode.

It should not be the default architecture for preview/publish.

## 6. Delivery Phases

## Phase 0: CLI foundation

- add `packages/cli`
- expose `vivd`
- extract shared connected backend client
- install CLI on Studio machine
- ship `help`, `doctor`, `whoami`, `project info`
- ship plugin parity commands
- update agent instructions to mention CLI discovery flow

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
- add guarded model editor

## Phase 4: Preview/publish rendering

- snapshot export
- preview integration
- publish integration
- first supported render pattern in sites

## Phase 5: Tool consolidation

- decide whether OpenCode tools stay direct-client based or shell out to `vivd`
- add focused `vivd_cms_*` tools only if they still add value beyond bash + CLI

## 7. Recommended First Vertical Slice

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

## 8. Immediate Next Steps

1. Create the CLI package and shared backend client.
2. Mirror existing plugin info/catalog surfaces in the CLI.
3. Add the first CMS tables and read-only CLI inspection commands.
4. Add the `ProjectContent` route and Studio toolbar/button wiring.
5. Land one narrow collection (`downloads`/`documents`) before broadening the field model.

## Current Leaning

The current recommended architecture is:

- **control plane DB** as canonical CMS store
- **`vivd` CLI** as the first-class structured agent interface
- **host app embedded pages** as the first Studio UI surface
- **generated preview/publish snapshots** as the site rendering mechanism
- optional `.vivd/` bridge files only as derived cache

This fits Vivd's current boundaries and avoids turning either project files or the agent into the primary CMS database.
