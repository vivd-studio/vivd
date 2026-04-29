# Vivd Project State

> Current handoff for agents. Durable roadmap direction lives in `ROADMAP.md`; historical detail lives in `PROJECT_STATE_ARCHIVE.md`.

## Current Handoff

- Hosted `platform` remains the default product lane; public `solo` self-hosting remains supported but intentionally narrower.
- Active priorities and near-term backlog live in `ROADMAP.md`.
- Keep this file short: retain only the latest two progress entries and archive older detail aggressively.

## Latest Progress

- 2026-04-29: Finished the next Studio media-drop polish slice. Gallery cards now hide generic storage tags like `Shared`, `Public`, `images`, and `working` while preserving entry-owned media tags; the drop planner still treats direct base-media files as shared library media. Public and legacy static image drops onto source-backed Astro images copy into `src/content/media/shared/` before the Astro source is patched to import the managed copy, and source matching now skips internal Astro component metadata in favor of real project `src/**/*.astro` annotations. Validation: focused Studio asset/preview/CMS/Astro patch tests, Studio typecheck, `npm run studio:dev:refresh`, and targeted `git diff --check` pass.
- 2026-04-29: Made the live Studio chat activity state clearer in light mode by adding fixed-width animated baseline `...` after the current action text while keeping the summary separator stable, preserving the newest live assistant text artifact below the summary, and adding a little bottom spacing between completed activity summaries and the final response. Validation: focused `AgentMessageRow` test, Studio client typecheck, targeted surface/diff checks, and `npm run studio:dev:refresh` pass.

## Archive

- Older progress entries, compaction summaries, and trimmed validation detail live in `PROJECT_STATE_ARCHIVE.md`.
- Superseded or historical plans live under `plans/old/`.

Last updated: 2026-04-29
