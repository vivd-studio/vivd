# Studio Media Drop UX Plan

Date: 2026-04-28  
Owner: Studio / Astro CMS / product UX  
Status: safe CMS drop behavior, unified gallery, and public/static Astro-source imports implemented; entry-aware/browser QA follow-ups remain

## Goal

Make Studio image drag/drop predictable, explainable, and safe for Astro-backed projects.

Dropping an image onto a preview image, CMS asset field, or source-backed Astro component should show the user what will happen before Studio writes anything. The implementation should converge on one maintainable drop-planning model instead of scattering path, target, and copy/reference decisions across UI event handlers.

## Implementation Progress

Implemented on 2026-04-28:

- Added a pure image drop planner and asset-scope classifier at `packages/studio/client/src/components/preview/imageDropPlan.ts`.
- Preview image drop zones now show target-local hover copy derived from the planner, including blocked reasons.
- Ambiguous CMS image drops can open an explicit choice dialog before the preview accepts the drop.
- Choosing `Make a copy for this entry` saves through a server-side copy-to-entry action that writes into `src/content/media/<collection>/<entry>/`, handles filename collisions, and stores the normalized CMS entry reference.
- Choosing `Use existing image` keeps the CMS field referencing existing managed media.

Implemented on 2026-04-29:

- Gallery is now a single image-only library instead of a folder/scope switcher.
- The library recursively indexes the known usable image roots: `src/content/media/**`, `public/**`, `images/**`, and `assets/**`.
- Entry-owned media can show a quiet card tag such as `blog/welcome`; generic storage tags such as `shared`, `public`, `images`, and `assets` stay hidden because they are implementation details. Folders remain available in Files for advanced work.
- Gallery uploads and Generate Image use the product-level `media library` target label; Astro projects still write new generated/uploaded images to `src/content/media/shared/` by default.
- Non-image uploads are rejected from Gallery with guidance to use Files.

Implemented in the follow-up pass:

- Safe CMS drops no longer open a dialog. Shared/library images are referenced directly; public, static, and working images are copied into the CMS entry automatically.
- The choice dialog is reserved for likely cross-entry ownership, where reusing the existing image versus making an entry-specific copy is a real product decision.
- The rare choice dialog uses user-facing option copy: `Make a copy for this entry` and `Use existing image`.
- Preview drop hover cleanup is now idempotent. A new drag session clears stale listeners/hints first, iframe drops clean up immediately, and repeated hover/drop cycles cannot stack handlers.
- Gallery cards no longer show generic storage tags such as `Shared`, `Public`, `images`, `assets`, or `working`; only entry-owned managed media keeps an ownership tag.
- Public and legacy static image drops onto source-backed Astro images now copy into `src/content/media/shared/` first, then patch the Astro source to import the managed copy.
- Source-backed Astro image drops now ignore internal Astro component source metadata and target the nearest real project `src/**/*.astro` source annotation instead.

Remaining follow-ups:

- Add entry-aware library behavior when the asset explorer is opened from a specific CMS entry, without exposing it as a primary folder tab. Good candidates are a suggested tag/filter, better default copy target, or a subtle "used by this entry" grouping.
- Do browser screenshot/interaction QA for the iframe hover overlay and rare ownership-choice dialog across light/dark themes and framed viewports.
- Consider extending the same planner shape to non-image file assets later; catalog/PDF UX remains tracked in [`plans/astro-cms-catalog-asset-ux-plan.md`](./astro-cms-catalog-asset-ux-plan.md).

## Original Behavior Snapshot

- General Studio image creation now has an Astro default of `src/content/media/shared/`.
- AI image edits are expected to write beside the source image unless a caller explicitly chooses another target.
- Before the 2026-04-29 pass, the generic asset gallery was still mostly folder-oriented, so it could make Astro media feel like "the shared folder" rather than a managed media library.
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
- Copying an image into entry-owned media is useful. If it is the only safe action, Studio can do it automatically; if ownership is genuinely ambiguous, Studio should ask.
- Shared media is a real product concept, but it should appear as metadata on images instead of as a required navigation choice for non-technical users.
- Working assets under `.vivd/**` should be treated as temporary references until imported into managed media.

## Asset Scopes

Use a shared classifier for image paths:

- `shared`: `src/content/media/shared/**` and direct files under `src/content/media/*`
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

Do not confirm every drop. Confirm only when the result is ambiguous or likely to surprise the user.

Cases that should ask:

- Dropping an entry-owned asset from one entry onto another entry:
  - primary choice: `Make a copy for this entry`
  - secondary choice: `Use existing image`

Cases that can proceed directly:

- Dropping a shared or general library image onto a CMS entry field.
- Dropping a public, static, or working image onto a CMS target when Studio can copy/import it into that entry first.
- Dropping an entry-owned asset onto a field in the same entry.
- Dropping a shared asset onto a source-backed Astro image where the planner will only patch source.
- Dropping a static asset onto an HTML/static image where Studio can update the `src` directly.

### Messaging

Use plain ownership language:

- `Shared media`: reusable across entries and pages.
- `This entry`: copied into this CMS entry's media folder.
- `Public file`: served directly from the site, not managed by CMS.
- `Working file`: temporary Studio file that should be imported before use.

Avoid exposing relative-path math as the primary message. Show exact paths in a quieter detail line or expandable technical detail.

## Media Library UX

Evolve the gallery from a raw folder view into a managed image library view.

Primary UX:

- Show one Gallery surface containing only images.
- Recursively include the known image roots Studio understands: `src/content/media/**`, `public/**`, `images/**`, and `assets/**`.
- Treat storage location as internal metadata, not as the main navigation model.
- Keep Files as the exact filesystem view for folders, PDFs, code, and advanced moves.

Card treatment:

- Show an ownership badge only for entry-owned managed media, for example `blog/welcome`.
- Show a compact path detail below the asset name.
- Keep existing file-tree navigation available for exact filesystem work.
- Make upload and Generate Image target labels product-level, for example `media library`; exact paths can stay in technical details or Files.

This makes `shared` the default storage decision, not the user's main mental model.

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

- Replace scoped Astro media tabs with one image-only media library.
- Add recursive discovery for managed media and known static/public image roots.
- Add entry ownership badges and product-level upload/generation target copy.
- Preserve the file tree for exact path operations.

Acceptance criteria:

- A user can find shared media and entry-owned media without understanding the folder tree first.
- Generate Image, upload, and gallery drops clearly state their product-level destination while keeping path details available when useful.
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
