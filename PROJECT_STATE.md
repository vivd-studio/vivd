# Vivd Project State

> Current handoff for agents. Durable roadmap direction lives in `ROADMAP.md`; historical detail lives in `PROJECT_STATE_ARCHIVE.md`.

## Current Handoff

- Hosted `platform` remains the default product lane; public `solo` self-hosting remains supported but intentionally narrower.
- Active priorities and near-term backlog live in `ROADMAP.md`.
- Keep this file short: retain only the latest two progress entries and archive older detail aggressively.

## Latest Progress

- 2026-04-28: Hardened ZIP project import failure handling after a production `atco` import exposed an orphaned project row and empty Studio startup path. ZIP imports now default to 250MB, reject oversize files client-side before upload, preserve backend JSON 413 errors, keep post-create import failures as durable failed versions instead of deleting the source, hide invalid no-version manifests, delete project metadata when the last version is removed, and prevent Studio start/restart for missing project versions. Validation: focused backend import/Studio tests, focused frontend import utility tests, backend/frontend/docs typechecks, targeted frontend ESLint for touched files, and `git diff --check` pass.
- 2026-04-28: Added `plans/plugin-license-allocation-plan.md` and linked it from the roadmap for organization-owned plugin license pools, project assignment/reassignment, self-serve license purchase, and superadmin override controls. Validation: doc-only, `git diff --check` pass.

## Archive

- Older progress entries, compaction summaries, and trimmed validation detail live in `PROJECT_STATE_ARCHIVE.md`.
- Superseded or historical plans live under `plans/old/`.

Last updated: 2026-04-28
