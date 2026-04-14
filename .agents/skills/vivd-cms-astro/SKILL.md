---
name: vivd-cms-astro
description: Use when working on Vivd CMS features for Astro-backed projects, including Astro content collection parsing/writing, Studio CMS UI behavior, preview text patching, image-drop persistence, localization ownership, or the local CMS helper/toolkit contract.
---

# Vivd CMS Astro

Use this skill when the task touches the Astro-backed CMS path in Vivd.

This skill is for:
- Studio CMS model or entry editing
- Astro collection parsing or writing
- `src/content.config.ts` support
- preview text editing or image drops that should persist to source
- CMS ownership bindings (`data-cms-*`, `CmsText`, `CmsImage`)
- localization ownership decisions (`data-i18n` vs CMS-localized fields)
- starter/generation guidance for Astro CMS projects

## Source Of Truth

For Astro-backed projects, the project repo stays Astro-native:

- models/schemas: `src/content.config.ts`
- structured entries: real files under `src/content/**`
- managed local assets: `src/content/media/`

Do not invent or reintroduce:
- Vivd YAML shadow schemas
- generated `.vivd` CMS source mirrors
- a Vivd-specific runtime content model inside the project repo

Vivd adapts to Astro Content Collections internally. The project itself should still look like an Astro project.

## Ownership Decision

Before editing, classify the render point:

1. CMS-owned content
   - value belongs to a collection entry field
   - persistence target is the entry file under `src/content/**`
   - preview ownership uses `data-cms-*`
   - render helpers are `src/lib/cms/CmsText.astro` and `src/lib/cms/CmsImage.astro`

2. Locale-dictionary UI text
   - navigation labels, buttons, placeholders, UI copy not owned by a CMS entry
   - persistence target is `src/locales/*.json`
   - preview ownership uses `data-i18n`

3. Page-owned source content
   - value belongs to page/component source, not a CMS entry
   - persistence target is `.astro` source
   - simple Astro image render points can be patched heuristically from preview
   - text uses Astro/raw fallback only when it is not CMS-owned and not i18n-owned

Do not stack `data-i18n` and `data-cms-*` on the same element.

## Patch Priority

Current preview persistence order:

- text: CMS field -> `data-i18n` -> Astro text patch -> raw HTML patch
- image: CMS field -> simple Astro `<Image>` / `<img>` source patch -> `public/` URL rewrite -> fail clearly

If the wrong persistence path is taken, the bug is usually an ownership bug, not a patcher bug.

## File Map

Start in these files:

- Shared CMS adapter/parsing/writing:
  - `packages/shared/src/cms/index.ts`
  - `packages/shared/src/cms/astroCollections.ts`
  - `packages/shared/src/cms/astroCollections/shared.ts`
  - `packages/shared/src/cms/astroCollections/schema.ts`
  - `packages/shared/src/cms/astroCollections/entries.ts`
- Shared agent/platform guidance:
  - `packages/shared/src/studio/agentInstructions.ts`
  - `packages/shared/src/studio/cliHelp.ts`
- Astro starter-local toolkit template:
  - `packages/backend/src/generator/templates/astro-starter/src/lib/cmsBindings.ts`
  - `packages/backend/src/generator/templates/astro-starter/src/lib/cms/CmsText.astro`
  - `packages/backend/src/generator/templates/astro-starter/src/lib/cms/CmsImage.astro`
  - `packages/backend/src/generator/templates/astro-starter/AGENTS.md`
- Studio CMS UI:
  - `packages/studio/client/src/components/cms/`
- Preview ownership + text patch collection:
  - `packages/studio/client/src/lib/cmsPreviewBindings.ts`
  - `packages/studio/client/src/lib/vivdPreviewTextPatching.ts`
- Preview inline edit/image drop flow:
  - `packages/studio/client/src/components/preview/usePreviewInlineEditing.ts`
- Astro source patching:
  - `packages/studio/server/services/patching/AstroPatchService.ts`
- Studio CMS mutations:
  - `packages/studio/server/trpcRouters/cms.router.ts`
  - `packages/studio/server/trpcRouters/project.ts`

## Default Workflow

1. Identify the source of truth for the requested change.
2. Inspect the current render point ownership in preview or source.
3. Change the write path first if persistence is wrong.
4. Only then change the UI or helper layer.
5. Validate with focused Studio/shared/backend tests.

## Common Rules

- Prefer `CmsText` and `CmsImage` for collection-owned render points.
- Use lower-level `cmsBindings.ts` helpers only when wrapper components are not a good fit.
- Bind every visible occurrence of a CMS-owned field, not just one.
- For localized CMS values, carry locale through CMS ownership, not `data-i18n`.
- Keep `src/content/media/` as the canonical managed asset root.
- Do not point markup at raw `src/content/media/...` filesystem paths.
- Use `public/` only for deliberate passthrough/framework-public assets.

## When The Issue Is About Preview Edits

Check these first:

- missing `data-cms-*` ownership on the actual render point
- image field modeled as plain string without enough signal for CMS/image UI affordances
- `data-i18n` used where the value is actually entry-owned
- render point is page-owned Astro source, not CMS-owned
- Astro image expression is too complex for the simple source-backed heuristic

## When The Issue Is About Starter Or Generation

The goal is to bias generated Astro projects toward patch-friendly, CMS-friendly patterns:

- straightforward `src/content.config.ts`
- real collection entries under `src/content/**`
- managed assets under `src/content/media/`
- `astro:assets` for local images
- `CmsText` / `CmsImage` when the content is explicitly collection-owned
- `data-i18n` only for locale-dictionary UI strings

Do not push all page copy into CMS by default. Use collections selectively for structured, repeatable, user-managed content.

## Validation

Read:
- `references/workflows.md`
- `references/validation.md`

Use the `testing` skill as a companion when the change crosses Studio/backend/shared boundaries.
