# Vivd (Monorepo)

Vivd is an AI-powered website builder: generate a site, preview/edit it in Studio, and publish it via Caddy.

## Project State & Roadmap

- See `PROJECT_STATE.md` for active roadmap, priorities, and open decisions.
- When plans change or work is completed, update `PROJECT_STATE.md` in the same change.
- If `PROJECT_STATE.md` starts accumulating too much closed-out detail again, suggest trimming it and moving older material into `docs/PROJECT_STATE_ARCHIVE.md`.

## Repo Shape

Vivd uses npm workspaces with a single root `package.json` and root `package-lock.json`.

- `packages/backend`: control-plane backend, publish/domain orchestration, Studio machine orchestration.
- `packages/frontend`: control-plane React UI.
- `packages/studio`: isolated Studio runtime (server + client) for workspace edits and agent operations.
- `packages/shared`: shared contracts, types, and cross-runtime helpers.
- `packages/theme`: shared CSS/theme tokens.
- `packages/docs`: public docs site.
- `packages/scraper`: dedicated scraping/screenshot service.
- `packages/plugin-*`: extracted first-party plugin packages.
- If a change affects user-facing behavior, update `packages/docs` or note the right docs section.

## Architecture Guardrails

- Studio file patching/edit logic (HTML/Astro/i18n patching) belongs in `packages/studio`.
- Keep backend and Studio responsibilities separate; avoid duplicating runtime patching logic across both.
- Frontend should depend on explicit shared contracts, not backend internals via ad-hoc local path aliases.
- Keep plugin-specific behavior plugin-owned where possible; keep host backend/frontend/CLI code generic and thin.
- Compatibility wrappers should stay thin adapters or re-exports; new plugin-specific behavior should land in the plugin package first.
- When a host workspace imports a plugin workspace package, add the dependency to the host `package.json` and update Docker/workspace-install contexts so local typecheck and container/runtime builds stay aligned.

For current plugin extraction details and common wiring pitfalls, use `.agents/skills/vivd-plugins/SKILL.md`.

## Reference Checkouts

- Keep upstream/reference repos under `vendor/`; they are for reference only, not runtime dependencies.
- `vendor/opencode` is the primary local OpenCode reference checkout.
- For external live/generated site repos being inspected alongside Vivd, use `vendor/sites/<repo-name>`.
- If a reference checkout is added, moved, or replaced, update this file and `PROJECT_STATE.md` in the same change.

## Studio / CLI Surface

- For connected runtime/platform operations, prefer the `vivd` CLI in `packages/cli` over custom wrappers.
- Prefer the generic plugin CLI surface: `vivd plugins ...`.
- Use `vivd help`, `vivd plugins help`, and `vivd publish help` to discover exact subcommands when needed.
- Treat `vivd publish checklist run` as an explicit full checklist pass, not a routine test command.
- Treat `.vivd/dropped-images/` as ephemeral working storage; move anything worth keeping into the project tree.
- The only remaining custom OpenCode tool on the agent surface is `vivd_image_ai`.

For deeper OpenCode/Fly/runtime behavior, use `.agents/skills/fly-studio-machines/SKILL.md` and the relevant docs under `docs/`.

## Generated Sites

- The generator outputs plain HTML (`index.html`) by default.
- Astro projects are also supported and can be built/served by the devserver.

## Package Manager / Self-Host / Config Rules

- Install dependencies at repo root.
- Avoid per-package lockfiles.
- Run scripts via workspaces, for example `npm run build -w @vivd/backend`.
- Public self-host/install docs should default to the `solo` profile. Do not casually surface or recommend `platform` or other multi-org/shared-control-plane behavior for general self-host flows.
- The public `solo` install bundle source of truth is `packages/docs/public/install/docker-compose.yml`.
- Add optional config knobs to `.env.example`.

## DB / Testing / Git

- Drizzle migrations only. Allowed flow: `db:generate` then `db:migrate`. Do not use `drizzle-kit push` / `db:push`.
- Avoid running full suites frequently; prefer targeted tests/builds for the touched area.
- During substantial multi-file work or refactors, run the relevant TypeScript check periodically instead of only at the end.
- Add meaningful tests that protect behavior; do not optimize for coverage alone.
- Release-impacting changes should come with the right focused regression tests or smoke coverage.
- Do not commit or push unless specifically requested. Git inspection commands are fine.
- When suggesting commit messages, prefer conventional commits such as `fix(scope): ...`, `refactor(scope): ...`, or `chore(scope): ...`.

## Maintenance Note

Keep this file focused on durable repo-wide rules and orientation. Put specialist runbooks, deep implementation notes, and transitional migration detail in focused docs or skills instead of expanding this file.
