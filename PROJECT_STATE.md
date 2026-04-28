# Vivd Project State

> Current handoff for agents. Durable roadmap direction lives in `ROADMAP.md`; historical detail lives in `PROJECT_STATE_ARCHIVE.md`.

## Current Handoff

- Hosted `platform` remains the default product lane; public `solo` self-hosting remains supported but intentionally narrower.
- Active priorities and near-term backlog live in `ROADMAP.md`.
- Keep this file short: retain only the latest two progress entries and archive older detail aggressively.

## Latest Progress

- 2026-04-28: Added the first first-class project-copy workflow from `plans/project-import-duplicate-build-safety-plan.md`. Backend now has a build-free `ProjectCopyService`, version-level artifact prefix copying, and `project.duplicateProject`; frontend project cards expose only "duplicate selected version as a new project" and immediately insert an optimistic "Duplicating" card while the backend copy runs. Copy-version internals remain parked, but public API/UI exposure is disabled for now. Validation: focused backend copy/build/import tests, backend/frontend typechecks, targeted frontend ESLint, focused project-card status test, and `git diff --check` pass.
- 2026-04-28: Implemented the core Studio media-drop UX plan. Preview image drops now run through a pure planner with asset scopes and target ownership, show target-local hover copy, block unsupported drops with explicit reasons, and ask before ambiguous CMS media ownership changes. CMS preview saves can copy a dropped image into `src/content/media/<collection>/<entry>/` with collision-safe filenames before storing the normalized entry reference, while shared-media references remain explicit. The Astro asset gallery now has Browse, Shared, All Media, and Public scopes plus scope badges on image cards. Validation: focused Studio asset/preview/CMS router tests, Studio typecheck, `npm run studio:dev:refresh`, and targeted `git diff --check` pass.

## Archive

- Older progress entries, compaction summaries, and trimmed validation detail live in `PROJECT_STATE_ARCHIVE.md`.
- Superseded or historical plans live under `plans/old/`.

Last updated: 2026-04-28
