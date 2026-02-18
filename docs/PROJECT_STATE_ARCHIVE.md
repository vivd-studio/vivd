# Vivd Project State Archive

## Progress Log Archive

- 2026-02-18: added `scripts/delete-ghcr-dev-images.sh` helper to list/delete GHCR container versions with `dev-` tags (dry-run by default, `--apply` to execute).
- 2026-02-18: OpenCode object-storage sync narrowed to `opencode/storage` only (Fly entrypoint + local provider), with legacy read compatibility for `opencode/opencode/storage` and cleanup of stale non-storage OpenCode objects in bucket.
- 2026-02-18: superadmin studio machines tab now includes a studio image selector (lists semver + dev-* tags from GHCR, defaults to highest semver, and persists an override tag in DB so Fly reconcile/warmups use the selected image).
- 2026-02-18: updated OpenCode to `1.2.6` (Studio + backend dev images) and `@opencode-ai/sdk` to `^1.2.6`.
- 2026-02-18: fixed Fly revert/session-diff tracking by aligning studio OpenCode storage path with OpenCode's default (`~/.local/share/opencode`) and removing forced `XDG_DATA_HOME` overrides.
- 2026-02-18: added OpenCode bucket compatibility migration: hydrate now flattens legacy nested `opencode/opencode` data into the canonical directory, sync runs with delete semantics for cleanup, and stale `auth.json` bucket keys are removed.
- 2026-02-17: studio OpenCode Vertex support re-enabled — studio entrypoint + local/Fly studio-machine env handling now support `GOOGLE_CLOUD_PROJECT` with automatic `GOOGLE_APPLICATION_CREDENTIALS` default path assignment, optional `GOOGLE_APPLICATION_CREDENTIALS_JSON` file materialization, and default `VERTEX_LOCATION=global` (while keeping legacy `GOOGLE_API_KEY` auth for non-Vertex setups).
- 2026-02-17: added an opt-in Fly+bucket integration test for shutdown sync across stop/destroy/warm-reconcile restarts (`packages/backend/test/integration/fly_shutdown_bucket_sync.test.ts`); local runs currently fail because newly written source markers are not reaching bucket during those lifecycle transitions.
- 2026-02-17: Fly superadmin/manual machine reconciliation now runs with bounded parallelism (worker pool) instead of strict one-by-one processing, reducing full reconcile wall-clock time on larger machine sets (`FLY_STUDIO_RECONCILER_CONCURRENCY`, default `100`).
- 2026-02-17: studio preview selector mode — selecting elements no longer triggers button clicks/navigation (swallow pointer/mouse down/up + click + submit during selector mode; window-capture click avoids stuck “Loading preview…”).
- 2026-02-17: studio agent revert — added an opt-in integration test that asserts OpenCode `revert` + `unrevert` actually change files in a temp repo, plus production diagnostics (diff summary + warnings for no-op reverts).
- 2026-02-17: studio chat UX — element ref pills now render reliably (escape XPath quotes; parse Astro `source-file`/`source-loc` tags) and streaming now shows Thought blocks (reasoning deltas no longer dropped before `message.updated`).
- 2026-02-17: local studio reliability — backend **dev** Docker image now includes the `opencode` CLI needed for `STUDIO_MACHINE_PROVIDER=local`, and the studio OpenCode server manager now fails gracefully (instead of crashing) when `opencode` is missing.
- 2026-02-16: Fly periodic machine reconciliation now reuses the same drift checks as studio startup (`image`, `services`, `guest`, `STUDIO_ACCESS_TOKEN`) via shared provider logic, and warm-up reconciliation applies to any non-running machine with drift so edit starts are more consistently “ready to use”.
- 2026-02-16: Fly warm-up reconciliation reliability — stop treating post-update drift as fatal (Fly may not reflect `skip_launch` config updates immediately), read drift from `vivd_image` metadata (tolerate tag+digest refs), and make parking deterministic by retrying + waiting for `suspended` (otherwise record an error instead of reporting success). Added an integration test for the warm reconciliation flow.
- 2026-02-16: Fly machine region is immutable; changing `FLY_STUDIO_REGION` requires destroying/recreating existing studio machines (reconciler does not attempt in-place region migration).
- 2026-02-16: studio machine security — Fly studio machines now get a per-machine access token (`STUDIO_ACCESS_TOKEN`) and the studio server enforces it for tRPC + file/upload endpoints; embedded/fullscreen host URLs pass the token via URL hash, and static `/preview` serving now applies the same allowlist as `/vivd-studio/api/projects` to block `.git`/env/etc.
- 2026-02-16: Fly studio machine default region changed from `iad` to `fra`; explicit env overrides remain supported via `FLY_STUDIO_REGION` (or `FLY_REGION` fallback).
- 2026-02-16: source artifact sync switched to exact behavior across studio sync paths (studio source sync default, studio container sync loop, local studio-machine object-storage sync, and backend source artifact uploads) so deleted files are removed from bucket and no longer rehydrate back into workspaces.
- 2026-02-16: Fly studio machine sizing policy updated — performance machines now enforce RAM floor at `2 GiB * CPU count` (removed hard 4 GiB minimum), and machine config reconciliation now applies desired `guest` sizing (cpu_kind/cpus/memory) on non-running updates/hard restarts/image warm-ups.
- 2026-02-16: superadmin Fly machines overview now surfaces machine placement details explicitly (region + guest sizing: cpu kind/cpus/memory) in the table.
- 2026-02-16: studio Fly cold-start hardening — added a lightweight pre-start HTTP listener during S3 hydration to avoid Fly port-probe “connection refused” errors before the real studio server starts.
- 2026-02-16: studio preview navigation loading — show an explicit loading indicator when the preview iframe is navigating (slow link clicks / page transitions no longer look like “nothing happened”).
- 2026-02-16: studio preview loading recovery — add tRPC request timeouts + refresh cancellation and expand iframe retry to cover transient startup errors (reduces “Loading preview…” hangs after suspend/resume).
- 2026-02-16: studio edit mode hardening — prevent accidental navigations while editing (clickable elements no longer steal clicks), patch the currently viewed HTML file instead of always `index.html`, and show an actionable “ask the agent” message when an edit can’t be applied.
- 2026-02-16: studio preview PDF downloads — clicking PDF/download links inside the preview iframe now opens/downloads the file outside the sandbox (avoids Chrome “blocked” page) while preserving base-path URL rewriting.
- 2026-02-16: studio assets UX — added in-studio PDF viewer overlay and avoid opening binary files in the text editor (fallback: open/download in a new tab).
- 2026-02-16: studio snapshots history sidebar now runs load-version as a single-flight action with explicit per-item loading feedback, and blocks other git actions while a git mutation is in-flight (prevents queued duplicate operations/toast bursts).
- 2026-02-16: studio devserver routing fix — run the workspace devserver at base `/` and keep `/preview` + `/vivd-studio/api/devpreview/...` working via proxy path stripping + stronger URL/redirect rewriting (fixes nested routes like `/product/56`).
- 2026-02-16: studio devserver recovery — added 1-click restart/clean-reinstall controls (preview overlay + toolbar menu), improved process-tree killing, auto-restart on snapshot loads, and force-reinstall logic when package.json/lockfiles change (avoids “reboot to recover” after git version switches).
- 2026-02-16: embedded studio UX hardening — added studio → host "ready" handshake plus iframe startup overlay + timeout fallback (reload + hard restart) to avoid black-screen hangs when a studio machine is slow/unresponsive.
- 2026-02-16: studio chat reliability — OpenCode session list now loads on initial open (wait for opencode server readiness + short bootstrap polling while sessions hydrate).
- 2026-02-16: studio chat UX — added an explicit session-loading state when switching sessions to avoid briefly showing the “new session” empty prompt.
- 2026-02-16: studio snapshots GitHub Sync section is now collapsible and defaults to collapsed, with key repo/status info visible while collapsed.
- 2026-02-16: fixed studio changed-files filename truncation edge case so paths are parsed defensively and shown without truncating the first character.
- 2026-02-16: studio snapshots sidepanel now exposes a subtle, collapsible list of changed file paths (collapsed by default) to make pending workspace edits easier to review before saving.
- 2026-02-15: superadmin Fly machines table now supports sortable columns and manual per-machine destroy action (stop-first, then destroy).
- 2026-02-15: integrated Fly studio machine management in backend: periodic reconciler (warm outdated images + GC machines older than 7 days) and superadmin tRPC endpoints for listing/reconciling machines.
- 2026-02-15: documented website plugin system plan (Contact Forms MVP) (`docs/plugin-system-design.md`).
- 2026-02-15: implemented Studio GitHub pull + force sync (ff-only + overwrite) with bucket exact-sync, superadmin-only gating, SSH URL copy, and environment repo prefix support via `GITHUB_REPO_PREFIX` (e.g. `dev-<org>-...`).
- 2026-02-14: documented publishing flow review + hardening/test plan (`docs/publishing-flow-review.md`).
- 2026-02-13: super-admin template maintenance now runs across all tenants (iterates every organization) instead of only the currently selected org.
- 2026-02-13: studio polling tuning — kept connected-studio workspace-state reporting default at 5s (configurable via `WORKSPACE_STATE_REPORT_INTERVAL_MS`) while retaining host-resolution log throttling to reduce backend log noise.
- 2026-02-13: publish prepared-time fix — prevented local studio bucket sync from overwriting `.vivd/build.json` so publish status reflects the latest save and doesn't revert.
- 2026-02-13: publish domain UX + gating fixes — allowed active tenant-host domains to be used for publish, added explicit allowlist denial reasons (missing/other-org/inactive), debounced publish-domain validation to reduce jitter, and surfaced user-friendly disabled-button reasons in publish dialogs (app shell + Studio).
- 2026-02-13: publish artifact metadata fix — ensured bucket build metadata includes `commitHash` for generated/imported artifacts and made git init commits reliable (prevents publish state from being stuck with “snapshot still being prepared” forever).
- 2026-02-13: publish improvements — added project-level `redirects.json` (validated + rendered into Caddy snippets), fixed extensionless `.html` routing, fixed `redir` directive generation, and switched template-file maintenance to bucket-only mode.
- 2026-02-13: tenant routing fixes — fixed host resolution precedence (active domains override `SUPERADMIN_HOSTS`), fixed canonical preview URLs, removed `__vivd_org` fallback, and reduced host-resolution log spam.
- 2026-02-13: studio sync hardening — ignore transient missing files during artifact upload, retry SDK sync before AWS CLI fallback, and fail with explicit diagnostics on missing CLI.
- 2026-02-13: documented GitHub → Studio → bucket git sync design (`docs/git-sync-plan.md`).
- 2026-02-12: tenant-domain governance — implemented `domain` registry + migration/backfill, host-based context resolution (`hostKind`), super-admin domain management UI, publish allowlist enforcement, tenant-host org switching + redirects, and canonical preview URLs.
- 2026-02-12: tenant routing stabilization — fixed prod lockout on base domain, org context fallback for studio machine calls, connected-studio 401s, cross-host org switching edge cases, and env propagation in compose deployments.
- 2026-02-12: bucket-first ZIP exports — made downloads object-storage-only, reintroduced "Download as ZIP" in studio toolbar, and triggered source-artifact sync after patch saves.
- 2026-02-12: documented Dokploy/Traefik wildcard setup runbook (`docs/dokploy-traefik-wildcard-setup.md`).
- 2026-02-11: studio reliability — added "Hard restart" for stale workspaces, Fly machine `replacing` state retry, serialized Git operations with `.git/index.lock` cleanup, and publish safeguards (block on unsaved changes / older snapshots).
- 2026-02-11: multi-org membership — enabled per-user multi-org with email-based auto-detect and session-based org switcher.
- 2026-02-11: misc — fixed bucket-first ZIP import with tenant isolation, optimized CI to build/push only changed images.
- 2026-02-10: admin cleanup — transaction safety for superadmin mutations, component splitting (`OrganizationsTab`, `AppSidebar`), reduced sidebar polling.


## Notes

- This archive preserves historical progress entries from the previous full `docs/PROJECT_STATE.md`.
- Active planning and next-step context now lives in `docs/PROJECT_STATE.md`.

Last updated: 2026-02-18
