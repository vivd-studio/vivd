---
name: vivd-cms-astro
description: Use when working on Vivd CMS support for Astro-backed projects, including Astro content collections, Studio CMS behavior, preview ownership, or page bindings for CMS-owned content.
---

# Vivd CMS Astro

Use this skill when the task touches the Astro-backed CMS path in Vivd.

## Quick Workflow

1. Classify the visible content before editing:
   - CMS-owned content
   - locale UI text
   - page-owned source content
2. Fix ownership or write-path bugs before changing Studio UI.
3. Keep Astro projects Astro-native. Vivd adapts to Astro Content Collections; it does not replace Astro's content model.
4. Use focused shared, Studio, and backend validation for the touched path.

## Durable Rules

- CMS-owned content is backed by a collection entry field, saved under `src/content/**`, and owned in preview via `data-cms-*`.
- Locale UI text lives in `src/locales/*.json` and is owned via `data-i18n`.
- Page-owned source content stays in `.astro` source.
- Do not stack `data-cms-*` and `data-i18n` on the same element.
- If preview persistence is wrong, assume an ownership or write-path bug before assuming a patcher bug.
- Keep `src/content/media/` as the managed asset root for CMS-owned local assets.

Avoid introducing:

- Vivd YAML shadow schemas
- generated `.vivd` CMS source mirrors
- a second Vivd-specific runtime content model inside the project repo

## Project Surfaces

Inside the Astro project, start with:

- `src/content.config.ts` for models and schemas
- `src/content/**` for collection entries
- `src/content/media/` for managed assets
- `src/lib/cms/CmsText.astro` for CMS-owned text
- `src/lib/cms/CmsImage.astro` for CMS-owned images
- `src/lib/cmsBindings.ts` only when wrapper components are not a good fit

## Repo Surfaces

In the Vivd repo, start with:

- `packages/shared/src/cms/astroCollections.ts`
- `packages/shared/src/cms/astroCollections/`
- `packages/studio/client/src/components/cms/`
- `packages/studio/client/src/lib/cmsPreviewBindings.ts`
- `packages/studio/client/src/components/preview/usePreviewInlineEditing.ts`
- `packages/studio/server/services/patching/AstroPatchService.ts`
- `packages/studio/server/trpcRouters/cms.ts`
- `packages/backend/src/generator/templates/astro-starter/src/lib/cmsBindings.ts`
- `packages/backend/src/generator/templates/astro-starter/src/lib/cms/CmsText.astro`
- `packages/backend/src/generator/templates/astro-starter/src/lib/cms/CmsImage.astro`

## Implementation Notes

- CMS ownership on Astro pages is explicit. Rendering `entry.data.*` or `item.data.*` only shows the current value; the visible render point still needs CMS bindings.
- Bind the actual visible element, including duplicate or derived render points that still represent the same CMS field.
- `CmsImage` needs the real field value through `src={...}`; metadata alone is not enough.
- Render preview-safe browser URLs instead of raw project-relative media paths.

## References

- Read [references/workflows.md](references/workflows.md) for deeper workflow guidance.
- Read [references/validation.md](references/validation.md) for deeper validation guidance.
- Pull in the `testing` skill when a CMS change crosses packages or needs broader regression coverage.
