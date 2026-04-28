# Vivd Project State

> Current handoff for agents. Durable roadmap direction lives in `ROADMAP.md`; historical detail lives in `PROJECT_STATE_ARCHIVE.md`.

## Current Handoff

- Hosted `platform` remains the default product lane; public `solo` self-hosting remains supported but intentionally narrower.
- Active priorities and near-term backlog live in `ROADMAP.md`.
- Keep this file short: retain only the latest two progress entries and archive older detail aggressively.

## Latest Progress

- 2026-04-28: Closed the remaining ZIP import handling gap after the ATCO production import surfaced hidden background work and a noisy Astro/Rollup failure. Accepted imports now show as `importing_zip`, project lists refresh while upload/import is in flight, failed cards show a short summary with expandable details, imported runtime artifacts are discarded, and npm Astro builds retry after stale lockfile/native optional dependency misses. Validation: focused backend import tests, focused frontend import/project-card tests, backend/frontend typechecks, targeted frontend ESLint for touched files, and `git diff --check` pass.
- 2026-04-28: Fixed the intermittent sidebar edge/rail divider on framed Projects, scratch, and project overview pages by deriving framed-route state from shared page info, normalizing trailing slashes, and suppressing the hover rail divider alongside the docked sidebar border. Validation: focused frontend shell tests, frontend typecheck, and `git diff --check` pass.

## Archive

- Older progress entries, compaction summaries, and trimmed validation detail live in `PROJECT_STATE_ARCHIVE.md`.
- Superseded or historical plans live under `plans/old/`.

Last updated: 2026-04-28
