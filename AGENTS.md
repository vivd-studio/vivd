# Vivd (Monorepo)

Vivd is an AI-powered website builder: generate a site, preview/edit it in Studio, and publish it via Caddy.

- If a prompt says `Vivid`, interpret it as `Vivd` unless the surrounding context clearly means something else; speech input often transcribes the product name that way.

## Project State & Roadmap

- See `ROADMAP.md` for active roadmap, priorities, and near-term backlog.
- See `PROJECT_STATE.md` for the current handoff and latest progress.
- When plans change, update `ROADMAP.md`; when work is completed or current handoff context changes, update `PROJECT_STATE.md` in the same change.
- Keep `PROJECT_STATE.md` compact, with only the latest two progress entries. Move older material into `PROJECT_STATE_ARCHIVE.md`.

## Repo Shape

Vivd uses npm workspaces with a single root `package.json` and root `package-lock.json`.

- `packages/backend`: control-plane backend, publish/domain orchestration, Studio machine orchestration.
- `packages/frontend`: control-plane React UI.
- `packages/studio`: isolated Studio runtime (server + client) for workspace edits and agent operations.
- `packages/shared`: shared contracts, types, and cross-runtime helpers.
- `plugins/sdk`: plugin contract and manifest SDK boundary.
- `plugins/installed`: instance-level installed plugin registry consumed by backend/frontend/CLI/Studio hosts.
- `plugins/external/*`: curated external/embed-style plugin packages with host-managed runtime behavior.
- `plugins/native/*`: extracted first-party plugin packages.
- `packages/theme`: shared CSS/theme tokens.
- `packages/docs`: public docs site.
- `packages/scraper`: dedicated scraping/screenshot service.
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

For deeper OpenCode/Fly/runtime behavior, use `.agents/skills/fly-studio-machines/SKILL.md` and the relevant docs under `plans/`.

Please run `npm run studio:dev:refresh` after you have made changes to the studio code.

## Generated Sites

- The generator outputs plain HTML (`index.html`) by default.
- Astro projects are also supported and can be built/served by the devserver.

## Package Manager / Config Rules

- Install dependencies at repo root.
- Avoid per-package lockfiles.
- Run scripts via workspaces, for example `npm run build -w @vivd/backend`.
- The hosted `platform` path is the managed SaaS product lane; prefer decisions that simplify, harden, or clarify hosted control-plane and customer-facing platform workflows when a task does not explicitly target self-hosting.
- Treat `solo` self-hosting as a public but narrower product path: one primary host, Docker-based Studio machines, and local S3-compatible storage by default. Do not imply full hosted-platform parity unless the code and docs support it.
- Keep public docs and default product copy clear about both paths: hosted remains invite-led/managed, while `solo` self-hosting is available for people who want to run Vivd themselves.
- If a task explicitly touches the self-host install path, the install bundle source of truth remains `packages/docs/public/install/docker-compose.yml`.
- Add optional config knobs to `.env.example`.

## DB / Testing / Git

- Drizzle migrations only. Allowed flow: `db:generate` then `db:migrate`. Do not use `drizzle-kit push` / `db:push`.
- Avoid running full suites frequently; prefer targeted tests/builds for the touched area.
- During substantial multi-file work or refactors, run the relevant TypeScript check periodically instead of only at the end.
- Add meaningful tests that protect behavior; do not optimize for coverage alone.
- Release-impacting changes should come with the right focused regression tests or smoke coverage.
- Do not commit or push unless specifically requested. Git inspection commands are fine.
- When suggesting commit messages, prefer conventional commits such as `fix(scope): ...`, `refactor(scope): ...`, or `chore(scope): ...`.

## UI / Surfaces

- Vivd has one surface / elevation language shared by `packages/frontend` and `packages/studio`. Any new container, tile, callout, status chip, or form field should go through the primitives in `@vivd/ui` (`Panel`, `StatTile`, `Callout`, `StatusPill`, `Field`) — not hand-rolled `rounded-* border bg-*` constructions.
- Before reaching for `bg-muted/NN`, `bg-card`, `bg-background/NN`, or raw tailwind palette colors (`bg-orange-50`, etc.) for UI state, read `.agents/skills/frontend-surfaces/SKILL.md`. It defines the surface roles (`surface-page/panel/sunken/raised/input`), the primitive lookup, the corner-radius rules, and the ban list.

## Maintenance Note

Keep this file focused on durable repo-wide rules and orientation. Put specialist runbooks, deep implementation notes, and transitional migration detail in focused docs or skills instead of expanding this file.
Treat `.agents/skills/` as living repo memory: after solving a hard problem, proactively create or update the relevant skill with durable learnings, debugging guidance, and the highest-signal validation paths.

## Additional Instructions by the creator

Before working on a task, try to understand the users actual underlying intent. If the user is aking to suggest, don't edit yet, try to understand what you need to do and proactively plan for yourself. Only then edit the code. When getting asked a question rather answer before you implement. Treat your interaction like a conversation.
Treat light and dark themes as rather different and distinct from each other.
