---
name: vivd-cms-astro
description: Use when working on Vivd CMS support for Astro-backed projects, including Astro content collections, Studio CMS behavior, preview ownership, or page bindings for CMS-owned content.
---

# Vivd CMS Astro

Use this skill when the task touches the Astro-backed CMS path in Vivd.

## How The System Works

Vivd adapts to Astro Content Collections; it does not replace Astro's content model.
For Astro-backed projects, the project repo should stay Astro-native:

- models and schemas: `src/content.config.ts`
- entries: real files under `src/content/**`
- managed local assets: `src/content/media/`

Avoid introducing:
- Vivd YAML shadow schemas
- generated `.vivd` CMS source mirrors
- a second Vivd-specific runtime content model inside the project repo

## How The Agent Should Interact With It

Before editing, classify the visible content first:

- CMS-owned content: backed by a collection entry field, saved under `src/content/**`, and owned in preview via `data-cms-*`
- locale UI text: saved to `src/locales/*.json` and owned via `data-i18n`
- page-owned source content: saved directly in `.astro` source

Rules:
- Fix ownership or write-path bugs before changing Studio UI.
- Do not stack `data-cms-*` and `data-i18n` on the same element.
- If preview persistence is wrong, assume an ownership bug before assuming a patcher bug.
- Use focused Studio/shared/backend validation for the touched path. Pull in the `testing` skill when a change crosses packages.

## How It Is Implemented On Pages

CMS ownership on Astro pages is explicit. Rendering `entry.data.*` or `item.data.*` only shows the current value; the visible render point still needs CMS bindings.

Use:
- `src/lib/cms/CmsText.astro` for CMS-owned text
- `src/lib/cms/CmsImage.astro` for CMS-owned images
- `src/lib/cmsBindings.ts` only when wrapper components are not a good fit

Keep in mind:
- Bind the actual visible element, including duplicate or derived render points that still represent the same CMS field.
- `CmsImage` needs the real field value through `src={...}`; metadata alone is not enough.
- Keep `src/content/media/` as the managed asset root and render preview-safe browser URLs instead of raw project-relative media paths.

## Main Implementation Surfaces

Start in these files:
- shared Astro CMS adapter: `packages/shared/src/cms/astroCollections.ts` and `packages/shared/src/cms/astroCollections/`
- Studio CMS UI: `packages/studio/client/src/components/cms/`
- preview ownership and inline editing: `packages/studio/client/src/lib/cmsPreviewBindings.ts` and `packages/studio/client/src/components/preview/usePreviewInlineEditing.ts`
- Astro source patching: `packages/studio/server/services/patching/AstroPatchService.ts`
- Studio CMS mutations: `packages/studio/server/trpcRouters/cms.router.ts`
- Astro starter bindings: `packages/backend/src/generator/templates/astro-starter/src/lib/cmsBindings.ts`, `packages/backend/src/generator/templates/astro-starter/src/lib/cms/CmsText.astro`, and `packages/backend/src/generator/templates/astro-starter/src/lib/cms/CmsImage.astro`

For deeper workflow or validation detail, read `references/workflows.md` or `references/validation.md` only when the task needs that extra specificity.
