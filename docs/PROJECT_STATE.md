# Vivd Project State (Condensed)

> Goal: run Vivd as a reliable multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and predictable publish/preview flows.

## Current Status

- Architecture split is in place: control plane (`packages/backend`) and isolated studio runtime (`packages/studio`).
- Bucket-first runtime is active for source, preview, and publish flows.
- Fly studio orchestration is production-ready for core lifecycle paths (start, suspend, reconcile, image rollout).
- OpenCode revert/restore reliability is currently being debugged with trigger-driven (non-periodic) OpenCode sync for `opencode.db*` + `storage/session_diff` on Fly.
- Superadmin machine operations are live (machine list/reconcile/destroy + image selector with semver and `dev-*` tags).
- Multi-org auth and tenant scoping are implemented across core control-plane paths.

## Progress Log

- 2026-02-24: added a dedicated Fly Vertex-only agent integration test in `packages/backend/test/integration/fly_vertex_only_agent_reply.test.ts`: it boots a studio machine with `OPENROUTER_API_KEY`/`GOOGLE_API_KEY` explicitly blanked while passing Vertex env (`GOOGLE_CLOUD_PROJECT` + ADC vars), asserts machine runtime env wiring, and verifies the agent returns an assistant reply using a Google model selection.
- 2026-02-24: tuned app-wide sidebar search input active-state affordance in `packages/frontend/src/components/shell/AppSidebar.tsx` so the field remains borderless at rest but uses a more separated filled background plus subtle outline shadow when focused or populated, improving focus visibility without reintroducing a static border.
- 2026-02-24: removed outdated agent-instruction guidance claiming AI image create/edit is unavailable; the default Studio agent instruction template in `packages/backend/src/services/agent/AgentInstructionsService.ts` no longer includes that limitation.
- 2026-02-24: refined the app-wide sidebar search input visual treatment in `packages/frontend/src/components/shell/AppSidebar.tsx` by removing the visible input border and simplifying input copy to `Search` (with matching accessibility/test selector updates in `packages/frontend/src/components/shell/AppSidebar.test.tsx`).
- 2026-02-24: evolved sidebar search into app-wide navigation search in `packages/frontend/src/components/shell/AppSidebar.tsx` by adding global destination indexing (project subpages like Plugins/Analytics/Preview, New Project route, and Super Admin Email tab), switching matching to multi-term query scoring (for example `plugins zeta`), and updating the search input UX with an inline magnifier plus `Search everything...` placeholder; extended sidebar search regression coverage in `packages/frontend/src/components/shell/AppSidebar.test.tsx`.
- 2026-02-24: replaced file-based `AGENTS.md` guidance with API-injected studio agent instructions by adding backend instruction rendering/config (`packages/backend/src/services/agent/AgentInstructionsService.ts` + `studioApi.getAgentInstructions`), injecting per-session OpenCode `system` prompts in Studio (`packages/studio/server/opencode/index.ts` + `packages/studio/server/services/agent/AgentInstructionsService.ts`), exposing superadmin get/set APIs for instruction templates, and removing `AGENTS.md` template generation/migration so project template scaffolding now maintains `.gitignore` only.
- 2026-02-24: polished sidebar-search UX in `packages/frontend/src/components/shell/AppSidebar.tsx` by softening the idle search-input visual treatment to blend with sidebar chrome and restructuring live search output into grouped sectioned results for faster scanning (instead of a flat repeated section subtitle list).
- 2026-02-24: fixed Studio machine image selection consistency and latest-tag stability by unifying effective desired-image resolution onto the Fly provider resolver for both machine-list and image-options APIs (`packages/backend/src/trpcRouters/superadmin.ts`), adding explicit resolver cache invalidation/force-refresh hooks used when clearing image pins and before manual reconcile (`packages/backend/src/services/studioMachines/fly/imageResolver.ts`, `packages/backend/src/services/studioMachines/fly/provider.ts`), and hardening GHCR semver alias readiness so `vX.Y.Z` and `X.Y.Z` variants are evaluated per version without dropping the highest ready semver (`packages/backend/src/services/studioMachines/fly/ghcr.ts`); also updated Super Admin Machines UI copy to label the effective desired image and show when GHCR latest candidate differs (`packages/frontend/src/components/admin/machines/MachinesTab.tsx`) with targeted router/GHCR regression tests.
- 2026-02-24: implemented sidebar navigation search in `packages/frontend/src/components/shell/AppSidebar.tsx` by adding a top-level `SidebarInput` and client-side search index/ranking over all sidebar subelements (projects including non-visible entries beyond the default top-5 list, organization tabs, settings, and superadmin items) with role/host-aware visibility gating, search-result navigation, and collapsed-sidebar query reset; added regression coverage in `packages/frontend/src/components/shell/AppSidebar.test.tsx`.
- 2026-02-24: drafted a sidebar navigation search implementation plan for `packages/frontend/src/components/shell/AppSidebar.tsx` to add a `SidebarInput`-driven filter that can list and navigate all sidebar subelements (projects, organization tabs, settings, and superadmin items) with role-aware visibility and targeted frontend tests.
- 2026-02-24: fixed label deletion semantics to remove tags organization-wide (not just from the currently edited project) by adding `project.deleteTag` in backend (`packages/backend/src/trpcRouters/project/tags.ts` + `ProjectMetaService.removeTagFromOrganization`) and wiring labels-popover delete confirmations to call this mutation from project cards, with updated router/popover regression tests.
- 2026-02-24: refined project-card label editing UX in `Edit label` to support inline click-to-type renaming directly on the colored label chip (no separate text input), Enter-to-apply behavior, and explicit label deletion from the same edit screen, while keeping commit-on-`OK` semantics and adding regression coverage in `packages/frontend/src/components/projects/listing/ProjectTagsPopover.test.tsx`.
- 2026-02-24: expanded the project-card labels popover `Edit label` flow so users can rename label text (not just change color) before confirming with `OK`; renames reuse existing tag normalization rules, preserve local color mapping for newly renamed tags, and now have targeted popover regression coverage in `packages/frontend/src/components/projects/listing/ProjectTagsPopover.tsx` and `packages/frontend/src/components/projects/listing/ProjectTagsPopover.test.tsx`.
- 2026-02-24: refactored email deliverability controls to superadmin-global/provider-agnostic scope: added global email feedback ingestion endpoint (`/email/v1/feedback/ses` for SES), centralized deliverability policy + suppression/event state in a shared email service (`packages/backend/src/services/email/deliverability.ts`), wired global superadmin APIs for policy/overview/unsuppress (`packages/backend/src/trpcRouters/superadmin.ts`), added new Super Admin → Email tab with webhook/policy/suppression/event views (`packages/frontend/src/components/admin/email/EmailTab.tsx`, `packages/frontend/src/pages/SuperAdmin.tsx`), and removed project-level deliverability settings from Project → Plugins (`packages/frontend/src/pages/ProjectPlugins.tsx`).
- 2026-02-24: fixed slug-rename thumbnail continuity by rewriting `project_version.thumbnail_key` from old-slug object-storage prefixes to new-slug prefixes during `project.renameSlug` transactional cutover in `packages/backend/src/trpcRouters/project/maintenance.ts`, and added read-time key realignment in `project.list` (`packages/backend/src/trpcRouters/project/generation.ts`) so already-renamed projects with stale thumbnail keys can still resolve card thumbnails without manual regeneration.
- 2026-02-24: hardened project-slug-rename UX for long-running operations by adding explicit in-progress loading states and temporary project-action locks during rename in dashboard cards and project pages (`packages/frontend/src/components/projects/listing/ProjectCard.tsx`, `packages/frontend/src/pages/ProjectFullscreen.tsx`, `packages/frontend/src/pages/EmbeddedStudio.tsx`), including guarded dialog closing, disabled edit/publish/menu actions, and blocking overlays so users cannot continue working on a project mid-migration.
- 2026-02-24: implemented project slug rename/change flow end-to-end and documented it in `docs/project-slug-rename-plan.md`: added backend `project.renameSlug` mutation in `packages/backend/src/trpcRouters/project/maintenance.ts` with input normalization, unpublished-project guard, studio stop-before-rename safety, object-storage prefix copy + best-effort cleanup (`copyBucketPrefix` in `packages/backend/src/services/storage/ObjectStorageService.ts`, `copyProjectArtifactsInBucket` in `packages/backend/src/services/project/ProjectArtifactsService.ts`), transactional slug cutover across slug-scoped tables (`project_meta`, `project_version`, `project_publish_checklist`, `project_plugin_instance`, `contact_form_submission`, `analytics_event`, `project_member`, project-scope `plugin_entitlement`, and `usage_record`), plus control-plane rename UX in project action menus/dialogs (`packages/frontend/src/components/projects/listing/ProjectCard.tsx`, `packages/frontend/src/pages/ProjectFullscreen.tsx`, `packages/frontend/src/pages/EmbeddedStudio.tsx`) with post-rename navigation to the new slug route.
- 2026-02-22: simplified Contact Form Turnstile automation env configuration to Cloudflare-native credentials only by removing `VIVD_TURNSTILE_*`/`VIVD_CLOUDFLARE_*` references from `packages/backend/src/services/plugins/contactForm/turnstile.ts` and `.env.example`; automation now reads only `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with fixed safe defaults for widget mode, domain cap, verification timeout, and sync interval, and production/self-hosted compose backend env passthrough now includes those two Cloudflare vars (`docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.self-hosted.yml`).
- 2026-02-22: drafted project archive feature plan in `docs/project-archive-plan.md`, defining a reversible `active|archived` project lifecycle with archive/unarchive APIs, active-vs-archived list filtering, UI/Studio action updates, lifecycle safety rules (published/assignment guards), and phased rollout/testing.
- 2026-02-22: delivered Analytics MVP step 1 (business conversions) across backend/frontend/runtime: `plugins.analyticsSummary` now includes previous-period KPI deltas, a contact-form conversion funnel (`pageviews -> form views -> form starts -> submissions`), and UTM attribution tables (campaign/source with submission-rate); analytics ingest now persists normalized custom `eventName` and UTM fields (`utm_source|medium|campaign|term|content`) in `analytics_event.payload`, and the dedicated analytics dashboard renders new `Period comparison`, `Conversion funnel`, and `UTM campaign attribution` sections.
- 2026-02-22: improved readability of the dedicated Project → Analytics page in `packages/frontend/src/pages/ProjectAnalytics.tsx` by reorganizing content into clearer sections (`Overview`, `Daily performance`, `Top pages`, `Top referrers`, `Device mix`, `Lead sources`), adding an at-a-glance summary panel, and replacing the long per-day card list with a compact scrollable table sorted latest-first; added regression coverage in `packages/frontend/src/pages/ProjectAnalytics.test.tsx`.
- 2026-02-22: added pagination to the project-first Super Admin → Plugins table in `packages/frontend/src/components/admin/plugins/PluginsTab.tsx` with a high page size of 100 projects and `Previous/Next` controls; search/state filter changes now reset to page 1 to keep navigation predictable.
- 2026-02-22: evolved Super Admin → Plugins into a project-first table in `packages/frontend/src/components/admin/plugins/PluginsTab.tsx`: each project now renders once with grouped per-plugin controls in-row plus bulk row actions (`Enable all plugins`, `Disable all plugins`, `Suspend all plugins`) to update all plugin entitlements for that project in one click.
- 2026-02-22: moved analytics into a dedicated business-facing project page at `Project → Analytics` (`/vivd-studio/projects/:slug/analytics`), extended `plugins.analyticsSummary` with Contact Form usage metrics (submissions, daily trend, top source hosts, submission-rate vs pageviews), and surfaced dedicated Analytics entry icons wherever project actions live when analytics is enabled (Studio toolbar quick actions, preview headers/menus, and dashboard project cards).
- 2026-02-22: added a new Studio OpenCode tool `vivd_image_ai` for prompt-only image generation and prompt+image edit/reference workflows (up to 5 input images), reusing existing OpenRouter image-model env knobs (`HERO_GENERATION_MODEL`, `IMAGE_EDITING_MODEL`) and saving generated outputs back into project files as `.webp`; wired registry enablement (`image_ai` feature flag) and updated OpenCode tool registry/module tests.
- 2026-02-22: completed Analytics plugin Slice 2 dashboard MVP: added backend `plugins.analyticsSummary` aggregation (7d/30d totals, daily trend, top pages, top referrers, device split) and rendered a project-level analytics dashboard in `packages/frontend/src/pages/ProjectPlugins.tsx`; also hardened analytics config updates so they no longer auto-enable the plugin (project members can view stats when superadmin-enabled but cannot self-enable via config writes).
- 2026-02-22: fixed Contact Form browser-submit post-success UX regression where forms without `_redirect` could leave users on the API host (`/plugins/contact/v1/submit` showing raw `ok`); the submit runtime now falls back to a safe same-host redirect derived from `Referer`/`Origin` and appends `_vivd_contact=success` when allowed by redirect/source host policy.
- 2026-02-22: made `vivd_publish_checklist` available only during checklist runs by default-disabling it in Studio tool policy and passing a per-run tool allowlist (`tools: { vivd_publish_checklist: true }`) through OpenCode `session.promptAsync` during `runPrePublishChecklist`; added regression coverage in `packages/studio/server/trpcRouters/agent.router.test.ts` and `packages/studio/server/opencode/index.sessions.test.ts`.
- 2026-02-22: consolidated Super Admin → Plugins project access into a single cross-plugin table in `packages/frontend/src/components/admin/plugins/PluginsTab.tsx`; Contact Form and Analytics rows now render together with a plugin column while preserving per-plugin controls (including Turnstile only for Contact Form), reducing duplicate list navigation.
- 2026-02-22: fixed connected publish dead-end when `publishState` is `ready` but `publishableCommitHash` is missing: `project.gitSave` now performs artifact prep even when there are no file diffs (using current HEAD hash), Publish dialog now offers an explicit `Prepare for publish` action in that state, and a targeted regression test was added in `packages/studio/server/trpcRouters/project.gitSave.test.ts`.
- 2026-02-22: improved publish-checklist item readability by removing note truncation in `packages/studio/client/src/components/publish/PrePublishChecklist.tsx`; checklist item notes now render full multi-line text (`whitespace-pre-wrap` + `break-words`) so operators can inspect complete agent findings without clipped content.
- 2026-02-22: fixed checklist-flow reliability issues that could look like an infinite `Checking` state in Studio local dev: long-running checklist mutations now use extended tRPC request timeouts in `packages/studio/client/src/main.tsx` (instead of the global 15s abort), checklist rows in `PrePublishChecklist` now render unfinished items as `Pending` (non-spinning) unless a run is actively in progress, and `vivd_publish_checklist` now defaults to the runtime project version (plus explicit per-run version instruction) to avoid writing checklist updates to `v1` when the active project is on another version.
- 2026-02-22: documented SSE migration triage and rollout plan in `docs/sse-polling-plan.md`, including a keep-vs-replace polling matrix, cross-instance robustness requirements, and phased delivery for generation, publish/checklist, and project-list freshness updates.
- 2026-02-22: enhanced Super Admin -> Plugins project list rows with deployment context by surfacing per-project publish status and deployed domain from `published_site` in `pluginsListAccess`, and rendering this as read-only "Deployment" info in the plugin access table.
- 2026-02-22: fixed a crash/restart checklist recovery bug where publish checks could remain visually stuck in `Checking`: pending-marker checklist rows now force `hasChangesSinceCheck=true` in `agent.getPrePublishChecklist` (connected and standalone), and the client auto-clears stale live-run state on dialog close, checklist completion, or timeout so users can always rerun after interrupted agent sessions.
- 2026-02-22: made OpenCode plugin-info tools context-conditional by wiring `requiredPlugins` in Studio tool policy (`vivd_plugins_contact_info` -> `contact_form`, `vivd_plugins_analytics_info` -> `analytics`), so these tools are exposed only for projects where the corresponding plugin is enabled; added policy test coverage in `packages/studio/server/opencode/toolRegistry.test.ts`.
- 2026-02-22: implemented Analytics plugin Slice 1 foundation across backend/frontend/studio: added analytics plugin registry + config/service plumbing (`packages/backend/src/services/plugins/analytics/*`, `ProjectPluginService`, `plugins.analyticsInfo`/`plugins.analyticsUpdateConfig`), public runtime endpoints for script + ingest (`/plugins/analytics/v1/script.js`, `/plugins/analytics/v1/track`) with entitlement/quota/rate-limit enforcement, analytics event storage migration (`packages/backend/drizzle/0018_analytics_plugin_mvp.sql`, `analytics_event` schema), superadmin Analytics entitlement panel in Plugins tab, and new OpenCode tool `vivd_plugins_analytics_info` registered in Studio tool policy/build outputs.
- 2026-02-22: refined Studio toolbar quick-action ordering for better action flow and discoverability: desktop quick actions now render as `Refresh → Plugins → Snapshots/History → Publish → More`.
- 2026-02-22: promoted Plugins to a first-class Studio toolbar quick action with a dedicated icon button (desktop quick actions), while keeping dropdown/mobile access paths, and standardized plugin entry-point icons to `Plug` (power-plug) across Studio/embedded/fullscreen/project-card menus for consistent plugin affordances.
- 2026-02-22: enforced Contact Form recipient safety by requiring at least one recipient and verifying every configured recipient email against verified organization-member emails; config saves now fail fast with `BAD_REQUEST` for empty/unverified recipient lists, and the Project → Plugins UI now states the verified-email requirement directly in recipient configuration help text.
- 2026-02-22: drafted analytics-plugin implementation plan in `docs/analytics-plugin-plan.md`, defining an MVP-first rollout that mirrors Contact Form integration patterns: superadmin entitlement controls (Analytics tab), OpenCode install-guidance tooling (`vivd_plugins_analytics_info`), public track/script runtime endpoints, and project-level traffic dashboards (pageviews/visitors/sessions/top pages/referrers) before advanced goals/conversions.
- 2026-02-22: drafted control-plane app-login landing + tenant redirect plan in `docs/app-login-landing-plan.md`, covering `vivd.studio` login entry to `app.vivd.studio`, post-login tenant-host handoff (`/vivd-studio`), host-aware root routing constraints, safe deep-link `next` handling, and rollout/testing slices.
- 2026-02-22: refreshed shared transactional email presentation to better match vivd.studio website branding: updated `packages/backend/src/services/email/templates.ts` with the live black/white/green visual language (cleaner card surface, pill-style black CTA, subtle green-tinted background accents) and switched the header branding to the website logo asset (`https://vivd.studio/images/vivd_logo_transparent.png`) across contact, verification, and password-reset emails; updated `packages/backend/test/email_templates.test.ts` assertions to lock logo presence.
- 2026-02-22: removed the “Websites in 48 hours…” slogan line from transactional email headers so branded emails keep a logo-only header treatment.
- 2026-02-22: improved Studio publish-checklist UX with live per-testpoint progress while checks run: checklist state now refetches at 1s intervals during a run in `usePrePublishChecklist`, and `PrePublishChecklist` renders each checklist item with a real-time `Checking` state (including pending rows and live completed count) so operators can watch item-by-item updates as the agent/tool writes checklist results.
- 2026-02-22: hardened pre-publish checklist execution by adding incremental checklist mutation support and OpenCode tooling: new backend atomic mutation `project.updatePublishChecklistItem` (item-level updates + server-side summary recomputation + structured missing/unknown-item errors), new studio OpenCode tool `vivd_publish_checklist` (`describe` + `update_item` actions), and connected-mode checklist-run orchestration in `packages/studio/server/trpcRouters/agent.ts` that seeds pending checklist state, instructs tool-driven incremental updates, waits for session completion, and keeps JSON parsing only as compatibility fallback.
- 2026-02-22: improved email-verification visibility in account settings by keeping an always-visible `Verified/Unverified` badge next to profile fields, so users still see current state after using resend-verification actions.
- 2026-02-22: added email-verification status visibility in admin UIs: Super Admin → System Users and Organization → Members now show `Verified/Unverified` badges; also added a post-login unverified-email prompt with resend action behind frontend feature flag `VITE_EMAIL_VERIFICATION_PROMPT_ENABLED` (default off until production SES is available).
- 2026-02-22: implemented transactional auth email flows on top of the shared provider/template stack: added centralized professional email templates in `packages/backend/src/services/email/templates.ts` (with legal footer links/details from vivd.studio Impressum/Datenschutz/AGB), refactored contact-form delivery to use the shared templates, wired Better Auth `emailVerification` + `sendResetPassword` callbacks through `EmailDeliveryService`, exposed env toggles for auth mail behavior in `.env.example`, and added control-plane UI/routes for forgot-password, reset-password, and resend-verification actions.
- 2026-02-22: fixed Studio Agent Chat composer surface mismatch after theme-token changes by unifying the input container onto a single `bg-card` surface and making the textarea/action-row backgrounds transparent so both sections keep the same color across states (focus/usage-blocked/drag-over).
- 2026-02-22: clarified Super Admin → Plugins scope by adding a plugin-level tab bar (starting with Contact Form) and refactoring the page to plugin-specific panel components so additional plugin tabs can be added without reworking the entire list UI.
- 2026-02-22: added Contact Form Turnstile protection as a superadmin-managed per-project entitlement toggle: new `plugin_entitlement` Turnstile columns + migration (`packages/backend/drizzle/0017_contact_form_turnstile.sql`), Cloudflare widget automation/sync/cleanup service (`packages/backend/src/services/plugins/contactForm/turnstile.ts`), submit-time Turnstile verification in public runtime (`packages/backend/src/httpRoutes/plugins/contactForm/submit.ts`), Turnstile snippet injection when configured, and Super Admin Plugins table controls/status.
- 2026-02-22: added explicit labels-popover confirmation action in project cards: tag edits are now committed only when pressing `OK`; closing/dismissing the popover without confirmation discards in-popover draft label changes.
- 2026-02-22: changed project-card labels popover behavior to defer tag assignment persistence until the labels popover closes (no per-click tag mutation while the popover is open), reducing distracting immediate card/list updates during label edits.
- 2026-02-22: drafted superadmin project-transfer implementation plan in `docs/superadmin-project-transfer-plan.md`, covering org-to-org transfer (including create-new-org flow), project-scoped DB cutover strategy, bucket-prefix migration, safety constraints, and rollout/test plan.
- 2026-02-22: normalized API surface naming across packages to reduce `routers/` vs `routes/` ambiguity: backend now uses `packages/backend/src/trpcRouters/` (tRPC) and `packages/backend/src/httpRoutes/` (Express HTTP), studio server tRPC modules moved to `packages/studio/server/trpcRouters/`, and scraper HTTP route modules moved to `packages/scraper/src/httpRoutes/`; updated backend/studio/scraper imports and affected tests accordingly.
- 2026-02-22: extracted large inline HTTP runtime handlers from entrypoints into explicit route modules to align with the naming split: backend preview/upload/download handlers moved from `packages/backend/src/server.ts` into `packages/backend/src/httpRoutes/projectRuntime.ts`, and studio runtime HTTP handlers moved from `packages/studio/server/index.ts` into `packages/studio/server/httpRoutes/runtime.ts` (with dependency-injected auth/path helpers to preserve behavior).
- 2026-02-22: made scraper builds clean output before compile (`packages/scraper/package.json`: `build` now runs `rm -rf dist && tsc`) so stale legacy `dist/routes/*` artifacts are not carried across naming migrations.
- 2026-02-22: fixed cross-workspace TypeScript build blockers revealed in frontend Docker builds: relaxed backend project-runtime `createContext` dependency typing in `packages/backend/src/httpRoutes/projectRuntime.ts` to accept tRPC adapter context args, and added frontend test matcher typings (`vitest/globals`, `@testing-library/jest-dom`) in `packages/frontend/tsconfig.app.json` so `toBeInTheDocument` resolves under `tsc -b`.
- 2026-02-22: hardened Contact Form submit abuse protection with human-friendly defaults: added per-token and per-IP burst limiting, a minimum repeat interval block (default 2s), and short-window duplicate-payload no-op handling in `packages/backend/src/httpRoutes/plugins/contactForm/submit.ts`; thresholds are env-tunable via `VIVD_CONTACT_FORM_MIN_REPEAT_SECONDS`, `VIVD_CONTACT_FORM_RATE_LIMIT_PER_IP_PER_MINUTE`, `VIVD_CONTACT_FORM_RATE_LIMIT_PER_TOKEN_PER_MINUTE`, and `VIVD_CONTACT_FORM_DUPLICATE_WINDOW_SECONDS`.
- 2026-02-22: documented Contact Form anti-abuse configuration knobs in `.env.example` (with default values and `0` disable semantics) so operators can discover tuning options without reading source.
- 2026-02-22: extended Contact Form anti-abuse defaults with additional low-friction checks: per-IP/per-token hourly caps, submission size caps (total + per-field), and max-link spam heuristics; all are env-tunable and documented in `.env.example`.
- 2026-02-22: strengthened Phase 2 backend business-service tests with behavior that guards real regressions: `packages/backend/test/limits_service.test.ts` now covers org-specific overrides, unlimited-zero semantics, and env fallback on DB read failures; `packages/backend/test/usage_service.test.ts` now covers error-swallowing on session-title updates and OpenRouter/image idempotency-key write semantics.
- 2026-02-22: extended Phase 2 OpenCode runtime hardening with `packages/studio/server/opencode/index.sessions.test.ts`, covering directory-scoped session filtering, backend/emitter status merge precedence, and abort side-effects (`idle` status + completion event emission).
- 2026-02-22: expanded Phase 2 Studio routing hardening with new behavior-focused router suites: `packages/studio/server/trpcRouters/project.router.test.ts` (connected shareable-preview URL resolution + dev-server lifecycle guards) and `packages/studio/server/trpcRouters/agent.router.test.ts` (workspace initialization gating, model-validation handoff, and session operation delegation).
- 2026-02-22: started closing Phase 3 scraper gaps with `packages/scraper/src/services/openrouter.test.ts`, adding meaningful checks for no-key short-circuit behavior, JSON parsing of model output, capped prioritization, and deterministic fallback on upstream failure.
- 2026-02-22: expanded Phase 3 scraper route hardening with new `packages/scraper/src/httpRoutes/findLinks.test.ts` and `packages/scraper/src/httpRoutes/screenshot.test.ts` suites, covering route validation, fallback navigation mode, link dedupe/filtering/max caps, screenshot max-capture behavior, and unhealthy-browser release on classified failures.
- 2026-02-22: expanded Phase 3 frontend routing confidence with `packages/frontend/src/app/router/guards.test.tsx`, covering auth redirect behavior, wrong-tenant control-plane fallback URL scheme selection, assigned-project enforcement for client editors, and single-project/dashboard redirects.
- 2026-02-22: expanded Phase 3 superadmin UI coverage with `packages/frontend/src/components/admin/machines/MachinesTab.test.tsx`, covering provider error display, stats rendering, refresh/refetch wiring, empty-state behavior, and reconcile confirmation flow mutation trigger.
- 2026-02-22: expanded scraper service resilience coverage with `packages/scraper/src/services/scraper.test.ts`, adding regression checks for navigation-failure classification and validation-error propagation while still returning collected content.
- 2026-02-22: added `packages/frontend/src/pages/EmbeddedStudio.test.tsx` to lock down project-loading guard states (loading, query-error, and missing-project paths) so studio shell regressions fail fast.
- 2026-02-22: strengthened `packages/scraper/src/httpRoutes/fullScrape.test.ts` with a no-OpenRouter-key branch check to ensure the route deterministically skips header-vision/subpage enrichment and still returns the primary page scrape.
- 2026-02-22: added `packages/studio/server/opencode/serverManager.missingBinary.test.ts` to verify `serverManager` fails fast with an explicit operator-facing message when the `opencode` CLI is unavailable, preventing ambiguous startup failures.
- 2026-02-22: completed the remaining Phase 2 backend router hardening slice by adding `packages/backend/test/organization_router.test.ts` (tenant-host mapping behavior and active-org selection safety around pinned domains, membership, suspended orgs, and superadmin override path).
- 2026-02-22: advanced Phase 2 test hardening with new control-plane router tests focused on behavior (not coverage-only): `packages/backend/test/usage_router.test.ts` (defaults/delegation), `packages/backend/test/studio_api_router.test.ts` (usage/reporting mapping, resilient thumbnail trigger behavior, workspace-state/checklist semantics), and `packages/backend/test/superadmin_router.test.ts` (Fly provider/image-option edge cases and plugin entitlement ensure/skip paths).
- 2026-02-22: shipped Phase 1 superadmin-managed Contact Form plugin entitlements end-to-end: DB table/migration (`plugin_entitlement`, `packages/backend/drizzle/0016_plugin_entitlements.sql`), entitlement service + APIs (`pluginsListAccess`, `pluginsUpsertEntitlement`, `pluginsBulkSetForOrganization`), and runtime gating in `plugins.contactEnsure` + public submit path.
- 2026-02-22: finalized plugin activation ownership model: project-level `Enable Contact Form` was removed, activation is now superadmin-only via Super Admin → Plugins, and project-level UI is guidance/config-only.
- 2026-02-22: consolidated settings/plugin surfaces onto shared shell conventions (tabs + bounded form widths) to reduce layout drift and simplify future settings work.
- 2026-02-22: completed project tag UX polish (project-card label placement + expanded color palette); tagging data model and API remain unchanged from the shipped tags feature.
- Full historical log moved to `docs/PROJECT_STATE_ARCHIVE.md`.

## Current Priorities

- [ ] Implement reversible project archiving (active/archived lifecycle, archive/unarchive actions, list filtering, and lifecycle guards) per `docs/project-archive-plan.md`.
- [ ] Execute SSE migration Phase 1 from `docs/sse-polling-plan.md` (generation status and project-list invalidation) while preserving polling fallbacks behind flags.
- [ ] Implement superadmin project-transfer flow (existing target org + create-new-org path) with DB cutover and bucket-prefix migration, per `docs/superadmin-project-transfer-plan.md`.
- [ ] Implement control-plane app login landing + automatic post-login tenant redirect per `docs/app-login-landing-plan.md`.
- [ ] Add Phase 4 E2E smoke coverage (lean PR suite + nightly/pre-release full suite) now that the current Phase 2/3 checklist targets are covered.
- [ ] Fix known failing Fly integration: `packages/backend/test/integration/fly_opencode_rehydrate_revert.test.ts` (expected red currently; revert-after-rehydrate path still broken).
- [ ] Complete remaining plugin-system Phase 1 follow-through: inbox/read path UX + operator workflow hardening around entitlements (self-serve/request flow still pending).
- [ ] Start Analytics plugin Slice 3 MVP+ conversions per `docs/analytics-plugin-plan.md` (custom events/goals after dashboard baseline).
- [ ] Validate lifecycle sync hardening in real Fly runs (stop/destroy/warm-reconcile + trigger-driven sync under larger workspace/opencode payloads).
- [ ] Finish object-storage source-of-truth migration in backend (remove remaining local-FS assumptions).
- [ ] Complete remaining auth onboarding hardening (invite-only signup flow + operator alerting/monitoring for transactional auth email delivery).
- [ ] Add missing control-plane hardening (audit log, monitoring, rate limiting, abuse controls).
- [ ] Implement billing primitives (Stripe products/prices/webhooks + subscription UX).
- [ ] Finalize build strategy and preview artifact contract (build location, signed vs public artifact access).

## Concrete Test Hardening Plan

### Baseline (2026-02-21)

- Backend statement coverage: `9.14%` (`packages/backend/src/**`).
- Studio statement coverage: `1.56%` (`packages/studio/**`).
- Frontend statement coverage: `1.02%` (`packages/frontend/**`).
- Scraper statement coverage: `5.76%` (`packages/scraper/src/**`).

### Phase 1 (Critical Runtime Safety)

- Backend auth/context + procedure gating:
  - `packages/backend/src/trpc.ts`
  - Cases: host-pinned org, unknown-host fallback, bearer session fallback, role gating (`protected/org/orgAdmin/projectMember/superAdmin`).
- Backend publish correctness:
  - `packages/backend/src/trpcRouters/project/publish.ts`
  - `packages/backend/src/services/publish/PublishService.ts`
  - Cases: studio-unsaved/older-snapshot conflicts, domain allowlist denial, artifact readiness conflicts, commit mismatch, caddy update + DB upsert/unpublish.
- Backend import safety:
  - `packages/backend/src/httpRoutes/import.ts`
  - Cases: org access denial, pinned-domain org override rejection, symlink archive rejection, root detection, imported artifact sync behavior.
- Studio workspace + sync fundamentals:
  - `packages/studio/server/workspace/WorkspaceManager.ts`
  - `packages/studio/server/services/sync/ArtifactSyncService.ts`
  - Cases: save/discard transitions, commit hash/state reporting, source/opencode sync trigger behavior and failure handling.

### Phase 2 (Control Plane and Studio Reliability)

- Backend organization/superadmin/usage routers (completed 2026-02-22):
  - [x] `packages/backend/src/trpcRouters/organization.ts`
  - [x] `packages/backend/src/trpcRouters/superadmin.ts`
  - [x] `packages/backend/src/trpcRouters/studioApi.ts`
  - [x] `packages/backend/src/trpcRouters/usage.ts`
- Backend business services (completed 2026-02-22):
  - [x] `packages/backend/src/services/usage/LimitsService.ts`
  - [x] `packages/backend/src/services/usage/UsageService.ts`
  - [x] `packages/backend/src/services/plugins/ProjectPluginService.ts`
- Studio routing/agent flows:
  - [x] `packages/studio/server/trpcRouters/project.ts`
  - [x] `packages/studio/server/trpcRouters/agent.ts`
  - [x] `packages/studio/server/opencode/serverManager.ts`
  - [x] `packages/studio/server/opencode/index.ts`

### Phase 3 (UI and Scraper End-to-End Confidence)

- Frontend RTL tests for high-impact flows:
  - [x] `packages/frontend/src/app/router/guards.tsx`
  - [x] `packages/frontend/src/components/projects/publish/PublishSiteDialog.tsx`
  - [x] `packages/frontend/src/pages/EmbeddedStudio.tsx`
  - [x] `packages/frontend/src/components/admin/machines/MachinesTab.tsx`
  - [x] `packages/frontend/src/components/projects/listing/ProjectsList.tsx`
- Scraper route + service tests:
  - [x] `packages/scraper/src/httpRoutes/fullScrape.ts`
  - [x] `packages/scraper/src/services/scraper.ts`
  - [x] `packages/scraper/src/services/openrouter.ts`
  - [x] `packages/scraper/src/httpRoutes/findLinks.ts`
  - [x] `packages/scraper/src/httpRoutes/screenshot.ts`

### Phase 4 (Critical E2E Smoke)

- Scope: only high-value cross-service flows that lower-level tests cannot fully validate.
- Initial scenarios:
  - auth + organization resolution on control-plane host vs tenant-pinned host
  - project creation/generation to reachable preview URL
  - studio edit flow where unsaved changes block publish, then save allows publish
  - publish/unpublish lifecycle and served-domain behavior
  - plugin contact submit to inbox/read path (after submit endpoint lands)
- Run cadence:
  - PR: run 2-3 fast E2E smoke tests
  - nightly/pre-release: run the full E2E smoke matrix

### First Wave Status (Complete)

- The initial hardening wave is complete across backend/studio/frontend/scraper for auth/context, publish/import safety, usage/plugins, workspace/sync, and scraper success/error behavior.
- Detailed per-test checklist history is preserved in `docs/PROJECT_STATE_ARCHIVE.md`.

## Consolidated Completed Milestones

- Studio runtime: standalone package extraction, connected/standalone operation, bucket hydration/sync, bucket-backed preview.
- Fly machines: machine reuse, warm reconciliation, stale cleanup, image drift handling, performance and cold-start resilience.
- Plugins: Contact Form runtime + public submit path, superadmin-managed entitlements (`plugin_entitlement`), superadmin-only activation flow, and optional per-project Turnstile protection with automated widget hostname sync.
- Projects dashboard: project tags shipped end-to-end (`project_meta.tags`, `project.updateTags`, card display/edit, list filtering).
- Test hardening: Phase 1 first-wave critical-path coverage delivered; follow-on depth/smoke layers remain active priorities.
- Agent/editor reliability: OpenCode `1.2.6` upgrade, revert/unrevert integration testing, selector-mode and streaming UX fixes.
- OpenCode storage cleanup: bucket sync narrowed to `opencode/storage`, legacy `opencode/opencode/storage` compatibility migration, stale non-storage key cleanup.
- Control plane: tenant scoping, project/usage limits, bucket isolation, publish-domain governance rollout.
- Auth/admin: superadmin organization/machine management, multi-org membership and active-org switching.

## Open Decisions

| Question | Status |
|---|---|
| Fly app strategy (single app vs app-per-tenant) | TBD |
| Concurrency model for edits (single-writer lock vs optimistic) | TBD |
| Build execution location (backend vs studio vs dedicated builder) | TBD |
| Preview artifact exposure (public vs signed URLs) | TBD |
| Studio URL pattern (iframe route vs redirect vs subdomain) | TBD |
| Cross-subdomain auth handoff for control-plane -> tenant redirect (shared cookie only vs one-time token fallback) | TBD |
| Project-transfer semantics: require unpublished in v1 and move usage-history rows by default? | TBD |
| Archive semantics: should archived projects count toward project limits and should API hard-delete require archived-first? | TBD (v1 proposal in `docs/project-archive-plan.md`) |

## Operational Notes

- OpenCode bucket sync (current test mode) writes `opencode.db*` plus `storage/session_diff` under `tenants/<tenant>/projects/<slug>/opencode/`; `snapshot/` and auth/cache/log artifacts remain excluded.
- Legacy fallback is still supported for hydrate from `.../opencode/opencode/storage/` to avoid data loss during transition.
- Dev image workflow:
  - Push: `./scripts/push-studio.sh [dev-tag]`
  - Cleanup `dev-*` GHCR tags: `./scripts/delete-ghcr-dev-images.sh` (dry-run default, add `--apply` to delete)

## Related Documents

- `docs/sse-polling-plan.md`
- `docs/analytics-plugin-plan.md`
- `docs/app-login-landing-plan.md`
- `docs/project-archive-plan.md`
- `docs/project-slug-rename-plan.md`
- `docs/superadmin-project-transfer-plan.md`
- `docs/refactoring-day-checklist.md`
- `docs/old/publishing-bucket-first-plan.md`
- `docs/old/tenant-subdomain-domain-governance-plan.md`
- `docs/old/dokploy-traefik-wildcard-setup.md`
- `docs/PROJECT_STATE_ARCHIVE.md`

Last updated: 2026-02-24
