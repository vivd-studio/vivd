# Astro CMS Catalog Asset UX Plan

## Goal

Improve the Studio CMS experience for Astro-backed catalog projects where editors need to manage downloadable files, especially PDFs, directly from the entry form.

The main target is to replace raw path editing like `hrefByLang.de = "/pdfs/products/97/..."` with first-class choose/upload/replace/remove flows in Studio.

## Current Reality

### Already implemented

- Shared CMS already supports generic `asset` and `assetList` field types.
- Studio already has a strong asset UI: picker, upload, replace, clear, download, and PDF preview.
- Validation already knows how to enforce that asset references stay under `src/content/media/`.
- Localized text fields are already semantic in the Studio form and Astro adapter.

### Current gaps

- The Astro adapter only maps `image()`-style schemas into first-class asset fields. Non-image file references usually stay plain `string` fields.
- Studio has image-specific heuristics for plain `string` and `string[]` fields, but no equivalent file/PDF heuristics.
- Localized assets are still out of scope, so locale objects like `hrefByLang` degrade into generic nested text inputs.
- Existing migrated catalogs may intentionally store runtime/public download URLs like `/pdfs/products/97/...pdf` backed by files under `public/`, while the current generic asset picker path was originally designed around `src/content/media/`.
- The Astro parser is narrower than Astro itself for schema reuse patterns such as extracted constants, aliased `z.object(...)` shapes, and some object spreads.
- The model editor still frames asset fields as image-oriented instead of generic file-oriented.

## Evaluation Of The Agent Feedback

### 1. Reusable schema fragment support

Valid request.

This is a real parser/validator parity gap. Studio should not reject or hard-fail on Astro-valid schema composition patterns that stay within a reasonable same-file scope.

### 2. File/asset fields in content collections

Valid request and highest-value priority.

This is the biggest UX gap for the product-catalog case. The important nuance is that the generic asset UI is already present in Studio. The missing work is Astro schema recognition plus localized asset rendering.

### 3. Localized field support

Partly already implemented.

Localized text is meaningfully supported today. The missing part is localized asset/file support, which is exactly what catalog download fields need.

### 4. Structured long-form content support

Valid request, but lower priority than file/PDF workflows.

There is internal `richText` support in the shared CMS layer, but the Astro path still needs a clearer Astro-native contract before this should be prioritized over catalog assets.

### 5. Validator/runtime parity

Valid request, but it overlaps with reusable fragment support.

The practical issue is less "match every Astro pattern immediately" and more "do not block editors with false negatives when the project is Astro-valid."

## Recommended Priority Order

1. First-class file/PDF asset fields for Astro collections
2. Localized asset/file fields in the Studio entry editor
3. Reusable schema fragments and softer parser/validator parity
4. Rich/structured long-form content

## Proposed Delivery Slices

### Ticket 1: Immediate UX stopgap for existing migrated projects

Broaden Studio-side Astro field inference so obvious file/download fields become asset controls even before a new explicit schema contract exists.

Scope:

- Add file-oriented field-name heuristics such as `pdf`, `file`, `download`, `brochure`, `datasheet`, `manual`, `spec`, `safetySheet`.
- Add value-oriented heuristics for local refs ending in `.pdf` and other allowed file extensions under `src/content/media/`.
- Preserve existing public/passthrough file storage models such as `/pdfs/...` by browsing/uploading under the matching `public/...` subtree and storing site-root URLs back into the entry instead of forcing `../media/...` rewrites.
- Extend the nested/object path so locale maps whose child values look like file refs can render as a localized asset field instead of a generic object block.

Acceptance criteria:

- Existing Astro entries with local PDF refs render choose/upload/replace/remove controls instead of plain text inputs.
- Existing Astro entries that store public download URLs such as `/pdfs/...` keep that storage contract after replace/upload and do not regress into broken `src/content/media` references.
- Existing locale objects like `hrefByLang.de` and `hrefByLang.en` render as one localized file field group.
- Plain remote URLs and non-media paths do not get incorrectly upgraded into managed asset UI.

### Ticket 2: Add an explicit Astro-safe CMS file asset contract

Introduce a durable way for Astro schemas to declare managed file assets without relying on heuristics.

Recommended direction:

- Add a small project-local schema helper under `src/lib/cms/`, not a Vivd runtime package dependency.
- The helper should wrap an Astro/Zod-compatible schema and attach Vivd CMS metadata for asset handling such as `kind: "asset"` and `accepts: ["application/pdf"]`.
- Keep the project Astro-native. Do not introduce a second repo-visible schema system.

Acceptance criteria:

- Astro build/runtime remains valid with the helper-wrapped schema.
- `vivd cms validate` recognizes helper-declared file assets without treating them as plain strings.
- `vivd cms validate` warns when a file/download field is only being inferred heuristically instead of explicitly declared through the helper contract.
- Empty file fields still render the asset picker UI correctly.
- Supported accepts can include at least `application/pdf`, image MIME types, and extension-based filters where needed.

### Ticket 3: Localized asset/file field support

Make locale-keyed asset objects first-class in the shared CMS field model and Studio renderer.

Scope:

- Extend localized field inference beyond text-like scalars.
- Teach the renderer to show per-locale `CmsAssetField` controls for localized assets.
- Keep validation and entry writes consistent with locale-object storage in the real entry file.

Acceptance criteria:

- A field shaped like `{ de: "../media/...pdf", en: "../media/...pdf" }` renders as one localized asset field with per-locale controls.
- Each locale supports choose/upload/replace/remove/preview.
- Saving preserves locale-object entry storage and validation remains green.

### Ticket 4: Make the model editor generic-file aware

Shift the Studio model editor away from image-only wording and support explicit file-oriented asset config.

Scope:

- Rename `Image asset` and `Image list` to generic `Asset` and `Asset list`.
- Add lightweight presets for common accepts such as `Image`, `PDF`, `Document`, and `Any file`.
- Preserve source-open fallback for unsupported custom Astro TypeScript patterns.

Acceptance criteria:

- Editors can create or update a generic file asset field without hand-editing raw source.
- The model editor can persist accepts metadata for file assets.
- Unsupported patterns still fail clearly into source-edit mode rather than producing broken rewrites.

### Ticket 5: Reusable schema fragments and non-blocking parser parity

Reduce false negatives from Astro-valid schemas that are only slightly more abstract than the current parser supports.

Scope:

- Resolve same-file const aliases that point to `z.object(...)` or other supported schema expressions.
- Support common same-file object spreads for schema fragments where the final result is still statically inspectable.
- When a pattern is Astro-valid but not yet Studio-editable, degrade to a clear warning or source-edit fallback instead of failing the whole CMS path.

Acceptance criteria:

- Same-file extracted schema fragments no longer cause avoidable validation failures.
- Unsupported-but-valid Astro patterns produce actionable diagnostics that distinguish platform limitation from project error.
- CMS status/validate remains trustworthy for real Astro projects.

### Ticket 6: Structured long-form content after the asset slice

Revisit rich/structured content only after file assets and parser parity are in better shape.

Reason:

- The catalog/PDF workflow is the higher-value editing bottleneck today.
- Rich content can build on the same improved parser/fallback strategy later.

Acceptance criteria:

- The later rich-content design chooses an Astro-safe contract deliberately instead of reusing plain strings by accident.
- The resulting editor flow covers serialization, preview ownership, and validation together.

## UX Notes For The Catalog Case

For catalog entries, the preferred entry experience is:

- one semantic "Downloads" or "Documents" section in the entry form
- per-document rows with file picker/upload controls, not raw path inputs
- per-locale file controls when the downloadable asset differs by locale
- derived filename display from the selected asset where possible
- optional separate localized label fields only when the user-facing label truly differs from the asset filename

This means the current pattern of editing both `hrefByLang` and `fileNameByLang` manually should be treated as transitional, not the desired end state.

## Agent And CLI Surface Follow-Up

### Agent instructions

Yes, but not as part of this planning-only change.

Once the explicit schema contract lands, add a short guidance update to `packages/shared/src/studio/agentInstructions.ts`:

- use the local CMS schema helper for managed PDFs/downloads in `src/content.config.ts`
- prefer localized asset fields for per-locale downloads instead of parallel raw path objects
- use the localized schema-helper variant for per-language downloads instead of raw `hrefByLang` string objects
- keep managed files under `src/content/media/`

The later explicit contract should also distinguish between:

- source-managed assets under `src/content/media/`
- public passthrough downloads under `public/` that must stay runtime-valid site URLs like `/pdfs/...`

That is the most important instruction surface because agents author `src/content.config.ts` directly.

### CLI help

Not needed unless the feature adds a new CLI command.

The existing `vivd cms status`, `vivd cms validate`, and `vivd cms helper ...` surfaces are enough for this scope.

The likely helper-install follow-up is not a new command, but an optional extension of `vivd cms helper install` so Astro CMS projects can add:

- a project-local schema helper module for file and localized-file fields
- a `CmsDownload.astro` render helper for localized labels plus preview ownership

## Validation Strategy

Focused validation for implementation work should include:

- `npm run test:run -w @vivd/cli -- src/cms.test.ts`
- `npm run test:run -w @vivd/studio -- client/src/components/cms/CmsFieldRenderer.test.tsx client/src/components/cms/CmsAssetField.test.tsx`
- add new shared/Studio tests for:
  - file-oriented Astro field inference
  - localized asset rendering
  - same-file schema fragment parsing
  - helper-declared file asset parsing and round-trip

## Summary

The core product problem is not that Studio lacks an asset UI. It already has one.

The real gap is that Astro-backed CMS projects cannot reliably express non-image file assets and localized file assets in a way that the current adapter and form renderer understand. That is the slice to fix first.
