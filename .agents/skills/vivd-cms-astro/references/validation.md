# CMS Validation

Prefer focused validation over broad suites.

## Shared CMS Adapter / Writer

- `npm run typecheck -w @vivd/shared`
- focused shared CMS tests if touched:
  - `npm run test:run -w @vivd/cli -- src/cms.test.ts`

## Studio Preview Ownership / CMS UI

- `npm run typecheck -w @vivd/studio`
- preview ownership / text patch tests:
  - `npm run test:run -w @vivd/studio -- client/src/lib/cmsPreviewBindings.test.ts client/src/lib/vivdPreviewTextPatching.test.ts`
- preview integration sanity:
  - `npm run test:run -w @vivd/studio -- client/src/components/preview/PreviewContext.test.tsx`
- Astro source patcher:
  - `npm run test:run -w @vivd/studio -- server/services/patching/AstroPatchService.test.ts`
- CMS router / editor behavior:
  - `npm run test:run -w @vivd/studio -- server/trpcRouters/cms.router.test.ts`

## Backend / Instructions / Starter

- `npm run typecheck -w @vivd/backend`
- instruction and starter coverage:
  - `npm run test:run -w @vivd/backend -- test/agent_instructions_service.test.ts test/initial_generation.test.ts`
- Studio-side agent instruction fallback:
  - `npm run test:run -w @vivd/studio -- server/services/agent/AgentInstructionsService.test.ts`

## Manual Checks That Matter

- entry edits update the real file under `src/content/**`
- localized CMS fields write to the expected locale branch
- locale-dictionary edits write to `src/locales/*.json`
- image drop on a CMS-owned image updates the entry file
- image drop on a simple page-owned Astro hero updates the `.astro` file with an import-based asset reference
- content UI still renders structured field editing, not only parsed raw data

