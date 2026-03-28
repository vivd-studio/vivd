# Headless CMS + Agent Interface Exploration

## Why this note exists

Vivd currently gives projects two primary editing surfaces:

- the Studio agent
- direct file editing in the workspace / file explorer

That works well for layout work, larger refactors, and generated-site iteration. It is weaker for small, frequent, structured edits such as:

- changing wording in a repeated content block
- swapping a PDF or other attachment
- maintaining a product catalog, team list, or FAQ
- editing plugin configuration without touching raw source

This note captures a direction where Vivd also acts as a headless CMS without breaking the current backend/Studio/OpenCode boundaries.

## Problem Statement

Vivd needs a structured content layer so that:

- users can edit structured data without manual file surgery
- agents can discover and update that data safely
- plugins and CMS-style content follow a coherent model
- published sites can render structured entries consistently
- small content edits stop depending on prompt-heavy file manipulation

## Constraints From The Current Architecture

- Plugin/business state already belongs in the control plane, not in Studio source files.
- Studio-provisioned OpenCode tools are already working as thin backend-backed transports.
- Workspace bridge files are acceptable only as derived cache, not as the source of truth.
- Studio source sync is exact, so the backend should not inject source files into an active workspace behind Studio's back.
- Generated sites are plain HTML by default, while Astro is also supported, so any CMS design must account for both rendering modes.

## Recommendation

### 1. Keep CMS state outside the workspace as the source of truth

The headless CMS should primarily live in control-plane-owned state, similar to plugin configuration.

That state likely needs:

- project-scoped content models/types
- content entries/items
- attachment references
- optional render metadata or view hints

This avoids treating raw project files as the canonical CMS database and makes it possible to support small edits cleanly from UI, agent, or automation surfaces.

### 2. Treat agent access as a transport concern, not the core CMS design

The agent needs a good way to work with CMS data, but that interface should sit on top of the control-plane services rather than define the underlying model.

Recommended layering:

- backend services own plugin and CMS business logic
- tRPC / HTTP APIs expose those operations
- Studio/OpenCode custom tools stay as the first integration path
- a future `vivd` CLI can be added as another thin client on top of the same APIs

The CLI is useful because it gives the agent a stable, inspectable interface on the Studio machine and makes future non-OpenCode integrations easier. It should not become a second source of product logic.

### 3. Use the CLI for structured operations, not as the only authoring UX

The CLI is a strong fit for:

- plugin info and plugin configuration actions
- content model inspection
- content entry CRUD
- help / discovery output for the agent
- admin/debug/operator workflows

The CLI is not a substitute for a real CMS editing surface for humans. If Vivd wants to be meaningfully "agent + CMS + deployment", the control-plane UI should eventually expose structured editing directly as well.

### 4. Keep workspace bridge files optional and derived

If the agent or project benefits from local discoverability, Vivd can materialize a derived cache inside the workspace, for example under `.vivd/`.

Possible examples:

- `.vivd/plugins.json`
- `.vivd/plugins.md`
- `.vivd/content/models.json`
- `.vivd/content/entries/*.json`
- `.vivd/content/README.md`

These files should be:

- generated from the canonical backend state
- safe to expose inside the workspace
- free of secrets
- treated as cache / bridge material, not as the source of truth

If this path is used, generation should happen from inside the Studio machine so it stays compatible with Vivd's exact sync model.

### 5. Separate content storage from rendering strategy

There are really two separate problems:

1. where structured content lives
2. how generated sites render it

The likely direction is:

- control plane owns the authoritative content state
- publish/build steps materialize a snapshot of that content for the site artifact

That snapshot could then be consumed differently depending on site type:

- plain HTML sites may need build-time rendering or generated static includes/data files
- Astro sites can more naturally consume generated JSON/data modules at build time

This suggests that content should be versioned or snapshotted at publish/build time, even if the live editing source of truth remains outside the workspace.

## Product Shape

The product vision becomes more coherent if Vivd is framed as:

- AI agent for structural/site edits
- CMS for structured/business content
- deployment/runtime for preview and publish

Under that framing:

- agent = best for broader site changes, refactors, and implementation work
- CMS UI = best for quick content updates and structured data maintenance
- CLI/tools = best for automation, agent access, and operator workflows

## Suggested CLI Shape

If Vivd adds a Studio-machine CLI, the first version should mirror existing backend-backed capabilities rather than invent new ones.

Examples:

- `vivd help`
- `vivd plugins catalog`
- `vivd plugins info contact`
- `vivd plugins configure contact ...`
- `vivd content models list`
- `vivd content models ensure products`
- `vivd content entries list products`
- `vivd content entries upsert products --file product.json`

The key rule is that CLI commands should call the same underlying service contracts as UI and tool surfaces.

## Open Questions

- Should CMS source of truth live in the DB, in object-storage-managed content bundles, or in a hybrid model?
- What is the minimal first-class content model: free-form JSON, typed fields, or collection templates?
- Should the CLI be the main agent surface, or an optional convenience wrapper around the same APIs?
- How should publish/versioning snapshot CMS data so a site build remains reproducible?
- What is the first CMS-shaped use case to validate the model: product catalog, team members, FAQ, downloads, or something else?
- How much of the first version needs a user-facing control-plane UI versus agent-only workflows?

## Recommended First Slice

Do not start with a full CMS system. Start with one narrow vertical slice:

1. Define one project-scoped structured content concept in the backend.
2. Expose read/write operations through the existing backend surface.
3. Add a thin agent-facing interface:
   - either one or two new OpenCode tools first
   - or a minimal `vivd` CLI that wraps the same calls
4. Materialize an optional derived `.vivd/` bridge file only if it clearly helps agent reasoning.
5. Render that content in one site pattern and verify the editing loop feels better than raw file editing.

The best initial candidate is probably a simple collection type such as products, team members, FAQs, or downloads/documents. That will test:

- schema shape
- attachments
- listing/detail rendering
- small-content-edit ergonomics
- agent discoverability

## Current Leaning

Current architectural leaning:

- control plane as CMS source of truth
- thin agent transports on top (`vivd_*` tools now, `vivd` CLI later if useful)
- optional derived workspace bridge files under `.vivd/`
- publish/build snapshotting for renderable site content

That preserves the existing Vivd boundary that runtime/business logic belongs in backend services, while still giving the agent better structured capabilities than raw prompt-driven file editing.
