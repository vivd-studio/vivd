# Test Suite Review

Date: 2026-01-09

## Current Coverage

- Backend unit tests focus on LLM-output parsing + patching (`backend/test/html_extraction.test.ts:1`, `backend/test/generator_utils.test.ts:1`, `backend/test/html_patch.test.ts:1`, `backend/test/i18n_json_patch.test.ts:1`), plus one real network integration test (`backend/test/integration/openrouter.test.ts:1`).
- Frontend tests cover preview text/i18n patch extraction utilities only (`frontend/src/lib/vivdPreviewTextPatching.test.ts:1`).
- Scraper has no automated tests (`scraper/src/services/scraper.ts:1`).

## What’s Good

- You picked high-leverage, deterministic logic to test first (HTML/JSON extraction and patching are core to “edit by asking” workflows) (`backend/src/generator/utils.ts:62`, `backend/src/services/HtmlPatchService.ts:217`).
- `I18nJsonPatchService` tests are isolated and filesystem-safe via temp dirs (`backend/test/i18n_json_patch.test.ts:1`).
- Most tests are fast and don’t require DB/auth/server startup.

## Issues / Improvements (Tests + Harness)

- Test folder mixes real tests and “manual scripts”: only `test/**/*.test.ts` runs (`backend/vitest.config.ts:1`), but `backend/test/test_html_extraction.ts:1`, `backend/test/test_image_gen.ts:1`, `backend/test/test_vision.ts:1`, `backend/test/test_deduplication.ts:1` look like tests and include network/side effects; this will confuse contributors and becomes a footgun if the include globs broaden later.
- Committed artifacts in `test/`: `backend/test/generated_image_1.png` (listed in `backend/test`) suggests “tests” generate files and they can end up committed; this doesn’t scale well (repo bloat + noisy diffs).
- Integration test opt-in isn’t strict enough: OpenRouter tests run automatically whenever `OPENROUTER_API_KEY` is set (`backend/test/integration/openrouter.test.ts:15`); in practice this can make “run tests” flaky (rate limits/model drift) or unexpectedly costly, especially as more devs/CI have keys.
- Backend test setup is cwd-fragile + non-hermetic: `dotenv` loads `../.env` (`backend/test/setup.ts:1`). If vitest is invoked from a different working directory, behavior changes; also it silently pulls in dev secrets/config which can make tests non-reproducible.
- Some assertions are too loose (risk of false positives):
  - HTML patch tests often only assert `toContain(...)` without validating structure or exact change boundaries (`backend/test/html_patch.test.ts:10`).
  - `extractHtmlFromText` tests never assert the “no HTML found → return original input” behavior (that case exists in the old chai file but isn’t executed) (`backend/test/test_html_extraction.ts:43`, `backend/vitest.config.ts:7`).
- Some tests assert implementation details that may become brittle: `result.applied` as “edits length” ties tests to internal edit accounting (`backend/test/html_patch.test.ts:23`, `backend/src/services/HtmlPatchService.ts:397`).

## Important Logic Paths Not Covered Yet (Even Within The Same Modules)

- `applyHtmlPatches` supports `setI18n` via inline-script rewriting (`backend/src/services/HtmlPatchService.ts:240`) but there are no tests that exercise `applyI18nPatchesToInlineScripts` (`backend/src/services/htmlPatching/i18nInlinePatches.ts:1`).
- `setAttr` “insert attribute when missing” logic is only superficially tested; the tricky insertion-point logic for self-closing tags isn’t actually exercised by your `<img src="old.jpg" />` test because that path updates an existing attribute (`backend/test/html_patch.test.ts:247`, `backend/src/services/HtmlPatchService.ts:362`).
- `detectActiveLanguage` has a primary `localStorage` branch that isn’t tested (`frontend/src/lib/vivdPreviewTextPatching.ts:36`, `frontend/src/lib/vivdPreviewTextPatching.test.ts:10`).
- `serializeI18nElementValue` removes `[data-vivd-editable-container]` but the tests don’t cover that branch (`frontend/src/lib/vivdPreviewTextPatching.ts:103`).

## Big App Areas Currently Untested (Scaling Risks)

- Backend request/auth/access control and proxying (`backend/src/server.ts:1`) and tRPC routers (`backend/src/routers/appRouter.ts:1`, `backend/src/routers/project.ts:1`, `backend/src/routers/user.ts:1`) have no tests; regressions here are high-impact.
- Publishing + git workflows are untested (`backend/src/services/PublishService.ts:1`, `backend/src/services/GitService.ts:1`).
- Astro patching is untested (`backend/src/services/AstroPatchService.ts:1`).
- Frontend pages/UX and admin flows are untested (`frontend/src/pages/Admin.tsx:1`), despite having complex role + form logic.
- Scraper behavior is untested (image capture heuristics, frame handling, dedupe rules) (`scraper/src/services/scraper.ts:1`).

## Highest-Value Next Improvements (No code changes, just direction)

- Separate unit vs integration suites (e.g., `test:unit` default/offline; `test:integration` behind `RUN_INTEGRATION=1`) so scaling the suite doesn’t punish dev iteration (`backend/test/integration/openrouter.test.ts:1`, `package.json:1`).
- Move the manual scripts out of `backend/test/` (or rename clearly) so “test” means “automated + hermetic” (`backend/test/test_image_gen.ts:1`, `backend/test/test_generator.ts:1`).
- Add a small contract/integration test that goes end-to-end: “DOM edit → patches from `collectVivdTextPatchesFromDocument` → apply in `applyHtmlPatches`” (right now you test each side, but not the seam) (`frontend/src/lib/vivdPreviewTextPatching.ts:113`, `backend/src/services/HtmlPatchService.ts:217`).
