# CMS Workflows

## Add Or Change A Collection Schema

1. Update `src/content.config.ts` handling in `packages/shared/src/cms/astroCollections.ts` and related writer paths in `packages/shared/src/cms/index.ts`.
2. Keep the supported Astro subset explicit. If the schema pattern is outside the supported subset, fail clearly instead of guessing.
3. Update Studio CMS model UI only after the parser/writer contract is correct.
4. Validate with shared parsing tests and Studio CMS router tests.

## Fix A CMS Entry Edit Bug

1. Confirm the field is really collection-owned.
2. Inspect the entry field path resolved by `data-cms-*`.
3. Check the write normalization in `packages/shared/src/cms/index.ts`.
4. If the issue is only visual, inspect `packages/studio/client/src/components/cms/`.
5. If preview save succeeds but the file is wrong, the bug is usually field-path or asset-path normalization.

## Fix Preview Text Editing

Use this order:

1. `packages/studio/client/src/lib/cmsPreviewBindings.ts`
2. `packages/studio/client/src/lib/vivdPreviewTextPatching.ts`
3. `packages/studio/client/src/components/preview/usePreviewInlineEditing.ts`
4. `packages/studio/server/trpcRouters/cms.router.ts` or `packages/studio/server/trpcRouters/project.ts`

Decision tree:

- collection-owned text -> `setCmsField`
- locale dictionary text -> `setI18n`
- source-owned Astro text -> `setAstroText`
- plain HTML fallback -> `setTextNode`

## Fix Preview Image Drops

Decision tree:

1. CMS-owned image field
   - use `data-cms-*`
   - persist through `setCmsField`

2. Simple page-owned Astro image
   - render point is a straightforward `<Image src={...} />` or `<img src="..." />`
   - persist through `setAstroImage`
   - Astro patcher injects/imports the new `src/content/media/...` asset

3. Public passthrough asset
   - raw URL rewrite can work

4. Complex computed Astro image expression
   - do not pretend the heuristic is robust
   - ask the agent/user to update the source explicitly or simplify the render point

## Add Localization Correctly

Use CMS-localized fields when:
- the text belongs to a collection entry
- different locales should live with that entry data

Use `src/locales/*.json` + `data-i18n` when:
- the text is UI copy, labels, buttons, placeholders, nav text
- it is not owned by a collection entry

Do not dual-own the same text.

## Starter / Generation Changes

When touching Astro generation:

- bias toward simple, source-backed Astro patterns that preview patchers can understand
- use `astro:assets` for local images
- use `CmsText` / `CmsImage` only for explicitly collection-owned content
- avoid generated patterns that hide ownership behind complex helpers too early

