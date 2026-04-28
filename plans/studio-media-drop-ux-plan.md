# Studio Media Drop UX Plan

Date: 2026-04-28  
Owner: Studio / Astro CMS / product UX  
Status: core slices implemented, follow-ups remain

## Goal

Make Studio image drag/drop predictable, explainable, and safe for Astro-backed projects.

Dropping an image onto a preview image, CMS asset field, or source-backed Astro component should show the user what will happen before Studio writes anything. The implementation should converge on one maintainable drop-planning model instead of scattering path, target, and copy/reference decisions across UI event handlers.

## Implementation Progress

Implemented on 2026-04-28:

- Added a pure image drop planner and asset-scope classifier at `packages/studio/client/src/components/preview/imageDropPlan.ts`.
- Preview image drop zones now show target-local hover copy derived from the planner, including blocked reasons.
- Ambiguous CMS image drops now open an explicit choice dialog before the preview accepts the drop.
- Choosing `Copy to this entry` saves through a server-side copy-to-entry action that writes into `src/content/media/<collection>/<entry>/`, handles filename collisions, and stores the normalized CMS entry reference.
- Choosing `Use shared asset` keeps the CMS field referencing existing managed media.
- Astro gallery mode now exposes `Browse`, `Shared`, `All Media`, and `Public` scopes, and image cards show scope badges such as `shared`, `blog/welcome`, `public`, and `working`.

Remaining follow-ups:

- Add a context-aware `This Entry` media scope when the asset explorer is opened from a specific CMS entry.
- Do browser screenshot/interaction QA for the iframe hover overlay and confirmation dialog across light/dark themes and framed viewports.
- Consider extending the same planner shape to non-image file assets later; catalog/PDF UX remains tracked in [`plans/astro-cms-catalog-asset-ux-plan.md`](./astro-cms-catalog-asset-ux-plan.md).

## Original Behavior Snapshot

- General Studio image creation now has an Astro default of `src/content/media/shared/`.
- AI image edits are expected to write beside the source image unless a caller explicitly chooses another target.
- The generic asset gallery is still mostly folder-oriented, so it can make Astro media feel like "the shared folder" rather than a managed media library.
- Dropping a managed shared image onto a CMS image field can validly store a reference to that shared asset, but the user is not told whether Studio is referencing shared media, copying into entry media, or patching source.
- Preview image targets are not all the same:
  - CMS-bound images should update a CMS field.
  - Source-backed Astro images should patch the source file/import.
  - Static HTML images should patch HTML.
  - Unsupported images should explain why they cannot be replaced from preview.

## Product Principles

- A drop should preview an explicit action before commit.
- CMS-owned targets write CMS fields. Page/source-owned targets patch source. Static HTML targets patch HTML.
- Astro managed media means `src/content/media/**`. `public/**` remains passthrough/static, not the default managed asset home.
- Studio should never silently move an image to a new folder during drop.
- Copying an image into entry-owned media is useful, but it should be an explicit choice or a clear confirmation, not a hidden side effect.
- Shared media is a real product concept. It should be visible in the UI instead of implied by paths.
- Working assets under `.vivd/**` should be treated as temporary references until imported into managed media.

## Asset Scopes

Use a shared classifier for image paths:

- `shared`: `src/content/media/shared/**`
- `entry`: `src/content/media/<collection>/<entry>/**`
- `managed`: other files under `src/content/media/**`
- `public`: files under `public/**`
- `working`: files under `.vivd/**`
- `legacy-static`: files under project-level static folders such as `images/**`
- `external`: remote URLs or unsupported paths

The classifier should be pure and covered by tests. UI badges, drop messages, and server-side copy defaults should all use the same scope language.

## Target Contexts

The drop planner should classify the target before execution:

- `cms-asset-field`: a CMS-bound image/file field with model, entry, and field path metadata.
- `astro-source-image`: an Astro source-backed image with source file and patch metadata.
- `static-html-image`: a static HTML image with editable `src`.
- `unsupported-image`: a visible image that cannot be safely written by Studio.
- `unknown`: missing metadata or stale preview state.

This keeps the product rule simple: target ownership decides the write path.

## Drop Planner

Add a pure planner module, likely under:

- `packages/studio/client/src/components/preview/imageDropPlan.ts`

The planner should accept:

- dragged asset path and scope
- target context
- project adapter context, especially Astro versus static HTML
- optional CMS collection/entry metadata

It should return a plan object with:

- `kind`: one of the concrete plan variants below
- `label`: short hover/confirmation text
- `detail`: path and ownership explanation
- `warnings`: non-blocking cautions
- `requiresChoice`: whether the user must choose before execution
- `choices`: allowed user choices where relevant
- `writes`: structured description of the server/client write operations

Plan variants:

- `set-cms-reference`: store a reference to an existing managed media file in the CMS field.
- `copy-to-cms-entry`: copy/import the asset into entry-owned media, then store the new entry-relative reference.
- `set-astro-source-image`: patch the Astro source/import for a source-backed image.
- `set-static-html-src`: patch a static HTML image reference.
- `import-working-asset`: copy a temporary `.vivd/**` asset into managed media before setting a target.
- `blocked`: explain why the drop cannot be completed.

The planner should be the single source of truth for hover copy, confirmation copy, execution branching, and tests.

## Drop UX

### Hover State

When the user drags an image over a replaceable target, show a small target-local overlay using Studio surface primitives.

Example labels:

- `Set Blog / Welcome / Hero image to shared/photo.webp`
- `Copy into Blog / Welcome media and set Hero image`
- `Replace source image with shared/photo.webp`
- `Update image source to /images/photo.webp`
- `This image cannot be replaced from preview`

Hover copy should include the target owner, not just the file path.

### Confirmation And Choice

Do not confirm every drop. Confirm only when the result is ambiguous, scope-changing, or likely to surprise the user.

Cases that should ask:

- Dropping a shared managed image onto a CMS entry image:
  - primary choice: `Copy to this entry`
  - secondary choice: `Use shared asset`
- Dropping a public or working asset onto a CMS target:
  - primary choice: `Import into managed media`
  - secondary choice: cancel
- Dropping an entry-owned asset from one entry onto another entry:
  - primary choice: `Copy to this entry`
  - secondary choice: `Use existing asset`

Cases that can proceed directly:

- Dropping an entry-owned asset onto a field in the same entry.
- Dropping a shared asset onto a source-backed Astro image where the planner will only patch source.
- Static HTML to static HTML path replacement in legacy/static projects.

### Messaging

Use plain ownership language:

- `Shared media`: reusable across entries and pages.
- `This entry`: copied into this CMS entry's media folder.
- `Public file`: served directly from the site, not managed by CMS.
- `Working file`: temporary Studio file that should be imported before use.

Avoid exposing relative-path math as the primary message. Show exact paths in a quieter detail line or expandable technical detail.

## Media Library UX

Evolve the Astro gallery from a raw folder view into a managed media library view.

Recommended scopes:

- `Shared`: `src/content/media/shared/**`
- `This Entry`: visible when Studio has CMS context, backed by `src/content/media/<collection>/<entry>/**`
- `All Media`: recursive view of `src/content/media/**`
- `Public`: files under `public/**` for passthrough/static use

Card treatment:

- Show a scope badge such as `shared`, `blog/welcome`, `media`, or `public`.
- Show a compact path detail below the asset name.
- Keep existing file-tree navigation available for exact filesystem work.
- Make upload and Generate Image target labels explicit, for example `Uploads go to Shared media`.

This makes `shared` the default, not the whole mental model.

## Server Execution

Add server helpers for the operations that must be authoritative on the filesystem:

- Copy/import an asset into `src/content/media/<collection>/<entry>/`.
- Generate a unique filename without overwriting existing media.
- Return the stored CMS field reference in the correct entry-relative format.
- Reject unsafe sources such as remote URLs unless a later import-from-URL flow is deliberately added.
- Keep `.vivd/dropped-images/` ephemeral by importing from it into managed media when the user chooses to keep the asset.

The CMS field update should remain separate from the copy helper so both pieces can be tested independently.

## Code Boundaries

- Keep pure planning separate from React drag/drop event plumbing.
- Keep path classification and Astro managed-media constants centralized.
- Keep CMS value normalization in the shared CMS layer or a dedicated Studio CMS utility, not embedded in components.
- Keep Astro and HTML patching logic in Studio server patching services.
- Keep the asset gallery responsible for browsing/choosing media, not deciding write semantics for preview drops.
- Use `@vivd/ui` primitives such as `Panel`, `Callout`, `StatusPill`, and `Field` for new overlays, sheets, or status chips.

## Implementation Phases

### Phase 1: Planner And Classifiers

- Add asset-scope classification.
- Add target-context classification.
- Add `computeImageDropPlan(...)`.
- Cover CMS, Astro source, static HTML, working asset, public asset, and blocked cases with unit tests.

Acceptance criteria:

- All drop decisions can be represented as plan objects without touching React state.
- Tests describe the expected action for shared-to-CMS, entry-to-CMS, working-to-CMS, shared-to-source, and unsupported drops.

### Phase 2: Hover Overlay

- Use the planner to show target-local hover text during dragover.
- Show blocked reasons before the user drops.
- Keep the overlay accessible and non-disruptive in light and dark themes.

Acceptance criteria:

- Users can tell before dropping whether Studio will update a CMS field, patch source, import a working file, or block the drop.
- The overlay does not cover resize handles, edit affordances, or nearby text in common image layouts.

### Phase 3: CMS Copy/Reference Choice

- Add the confirmation/choice UI for ambiguous CMS drops.
- Add the server copy/import helper.
- Write CMS fields only after the selected copy/reference action succeeds.

Acceptance criteria:

- Shared-to-CMS can either reference shared media or copy into entry media.
- Working-to-CMS requires import before saving.
- Entry-to-other-entry makes ownership clear.
- Filename collisions are handled deterministically.

### Phase 4: Managed Media Library

- Add scoped Astro media tabs or segmented controls.
- Add recursive `All Media` discovery for `src/content/media/**`.
- Add scope badges and clearer upload/generation target copy.
- Preserve the file tree for exact path operations.

Acceptance criteria:

- A user can find shared media and entry-owned media without understanding the folder tree first.
- Generate Image, upload, and gallery drops clearly state their target scope.
- Existing static/HTML project behavior remains understandable and backwards-compatible.

### Phase 5: Polish And Validation

- Verify keyboard/focus handling for confirmation UI.
- Check light and dark theme states separately.
- Add component tests for hover and confirmation text.
- Run focused Studio tests and typechecks.
- Run `npm run studio:dev:refresh` after Studio code changes.

## Validation Strategy

Focused validation for implementation work should include:

- planner unit tests for path scopes, target contexts, and plan variants
- Studio component tests for hover labels and confirmation choices
- server router/helper tests for copy-to-entry, unique filenames, and CMS value normalization
- existing Astro patch service tests for source-backed image replacement
- `npm run typecheck -w @vivd/studio`
- `npm run typecheck -w @vivd/shared` if shared CMS/path helpers change
- `npm run studio:dev:refresh` after Studio code changes

## Not In This Plan

- A broad asset DAM or tagging system.
- Automatic remote-image download/import.
- Silently moving existing project files after a drop.
- Replacing Astro Content Collections or changing the current CMS source of truth.
- Solving non-image file/PDF catalog UX. That is tracked separately in [`plans/astro-cms-catalog-asset-ux-plan.md`](./astro-cms-catalog-asset-ux-plan.md).
