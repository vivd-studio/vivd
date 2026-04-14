# Analytics Plugin Plan (MVP-First)

Status: Proposed  
Last updated: 2026-02-22

## Goal

Ship a first-party `analytics` plugin with the same integration model as Contact Form:

- superadmin-owned entitlement controls
- OpenCode tools that tell the agent exactly how to implement analytics on a site
- real analytics value in project UI (traffic and performance dashboards)

## MVP Value Order

1. Track and visualize page traffic reliably (pageviews, visitors, sessions, top pages, top referrers).
2. Make setup deterministic for agents and users (copy-safe snippet + OpenCode info tool).
3. Give superadmins control over access and event quotas.
4. Add custom events/goals only after core traffic reporting is stable.

## Scope

### In Scope (MVP)

- new plugin id: `analytics`
- superadmin plugin tab for analytics entitlement and event limits
- public analytics runtime endpoints
  - script endpoint to bootstrap tracking on generated/static sites
  - event ingest endpoint
- project analytics dashboard (last 7/30 days with core metrics + breakdowns)
- OpenCode tool `vivd_plugins_analytics_info` for install instructions/snippets

### Out of Scope (MVP)

- third-party ad network integrations
- cross-project/global analytics dashboards
- real-time websocket streaming
- multi-touch attribution and advanced funnels

## Proposed Data Model

### 1) Reuse existing plugin infrastructure

- `plugin_entitlement`: reuse as-is for access + monthly event limit + hard stop.
- `project_plugin_instance`: one analytics instance per project (`plugin_id='analytics'`).

### 2) New event table

Add `analytics_event` (Drizzle migration):

- `id text primary key`
- `organization_id text not null`
- `project_slug text not null`
- `plugin_instance_id text not null`
- `event_type text not null` (`pageview` initially; `custom` in MVP+)
- `path text not null` (normalized pathname only by default)
- `referrer_host text null`
- `source_host text null`
- `visitor_id_hash text null` (hashed; no raw visitor ids)
- `session_id text null`
- `device_type text null` (`desktop|mobile|tablet|bot|unknown`)
- `country_code text null` (optional in MVP if header-derived)
- `payload jsonb not null default '{}'` (small metadata envelope)
- `created_at timestamp not null default now()`

Indexes:

- `(organization_id, project_slug, created_at)`
- `(plugin_instance_id, created_at)`
- `(plugin_instance_id, event_type, created_at)`
- `(plugin_instance_id, path, created_at)`

### 3) Analytics plugin config (stored in `project_plugin_instance.config_json`)

MVP config keys:

- `respectDoNotTrack: boolean` (default `true`)
- `captureQueryString: boolean` (default `false`)
- `excludedPaths: string[]` (default `[]`)
- `enableClientTracking: boolean` (default `true`)

MVP+ config keys:

- `goals: [{ id, name, type, matcher }]`

## Runtime API Plan

Add backend routes under `packages/backend/src/httpRoutes/plugins/analytics/`:

1. `GET /plugins/analytics/v1/script.js?token=<publicToken>`
2. `POST /plugins/analytics/v1/track`

Behavior:

- validate token -> enabled plugin instance -> enabled entitlement
- enforce monthly quota using `plugin_entitlement.monthlyEventLimit` + `hardStop`
- apply lightweight abuse limits (IP/token burst caps, payload size caps)
- store normalized event row in `analytics_event`
- return `{ ok: true }` or short no-content response for beacon compatibility

Tracker JS MVP behavior:

- emits `pageview` on initial load
- generates ephemeral visitor/session ids client-side
- uses `navigator.sendBeacon` with fetch fallback
- exposes `window.vivdAnalytics.track(name, payload)` for MVP+ custom events

Privacy defaults:

- no raw IP persistence
- no cookies required (localStorage/sessionStorage identifier is enough for MVP)
- query strings excluded by default
- honor `DNT` when `respectDoNotTrack=true`

## Backend Service and tRPC Plan

### Service layer

Add analytics service modules parallel to contact-form structure:

- `packages/backend/src/services/plugins/analytics/config.ts`
- `packages/backend/src/services/plugins/analytics/service.ts`
- `packages/backend/src/services/plugins/analytics/snippets.ts`
- `packages/backend/src/services/plugins/analytics/publicApi.ts`
- `packages/backend/src/services/plugins/analytics/retention.ts`
- `packages/backend/src/services/plugins/analytics/queries.ts`

Update:

- `packages/backend/src/services/plugins/registry.ts` (`PLUGIN_IDS` + manifest)
- `packages/backend/src/services/plugins/ProjectPluginService.ts` (analytics methods)
- `packages/backend/src/services/plugins/PluginEntitlementService.ts` (`usageThisMonth` for `analytics`)

### tRPC routes

Extend `plugins` router with:

- `plugins.analyticsInfo` (token/snippet/instructions + current config)
- `plugins.analyticsUpdateConfig` (project-level analytics settings)
- `plugins.analyticsSummary` (metrics for dashboard range)

Keep `plugins.catalog` unchanged except new catalog entry.

## Superadmin Control Panel Plan

Add new tab to `packages/frontend/src/components/admin/plugins/PluginsTab.tsx`:

- tab id: `analytics`
- per-project entitlement actions: `Enable`, `Disable`, `Suspend`, `Limit`
- usage label: `Events (month)` instead of `Submissions (month)`
- no Turnstile controls for analytics panel

Backend reuse:

- existing `superadmin.pluginsListAccess`
- existing `superadmin.pluginsUpsertEntitlement`
- existing `superadmin.pluginsBulkSetForOrganization`

Required backend change:

- `pluginsListAccess` must compute `usageThisMonth` from `analytics_event` for `pluginId='analytics'`.

## Project UI Dashboard Plan

Extend `packages/frontend/src/pages/ProjectPlugins.tsx` to plugin tabs (`Contact Form`, `Analytics`):

Analytics tab sections (MVP):

- `Overview`
  - Pageviews (7d/30d)
  - Unique visitors (7d/30d)
  - Sessions (7d/30d)
  - Avg pages/session (derived)
- `Breakdowns`
  - Top pages
  - Top referrer hosts
  - Device split
- `Install`
  - script snippet + public token
  - implementation notes
- `Settings`
  - DNT, query string capture, excluded paths

If charting libs are not already part of frontend stack, use simple table/trend blocks first and defer heavier visualizations.

## OpenCode Tooling Plan

Add analytics info tool module:

- file: `packages/studio/server/opencode/toolModules/vivdPluginsAnalyticsInfo.ts`
- tool name: `vivd_plugins_analytics_info`
- behavior: calls `plugins.analyticsInfo` and returns JSON payload with:
  - install snippet(s)
  - endpoint details
  - expected behavior
  - step-by-step implementation notes for generated/static HTML

Register in:

- `packages/studio/server/opencode/toolRegistry.ts`
- tests: `toolModules.test.ts`, `toolRegistry.test.ts`

Feature flags:

- add `analytics` default feature flag toggle in tool policy map
- optional plugin gating via `requiredPlugins: ["analytics"]` if we only want it when enabled

## Delivery Slices

### Slice 1: Foundation (highest-value path)

1. DB migration for `analytics_event`.
2. Registry/service support for `analytics` plugin info + snippets.
3. Public ingest/script endpoints with entitlement/quota checks.
4. Superadmin analytics tab with enable/disable/limit.
5. OpenCode analytics info tool.

Exit criteria:

- superadmin can enable analytics for a project
- agent can fetch install instructions/snippet
- pageview events are being collected

### Slice 2: Dashboard MVP

1. `plugins.analyticsSummary` query with 7d/30d range.
2. Project Plugins analytics UI with overview metrics + top pages/referrers/devices.
3. Basic empty/error/loading states and date-range switch.

Exit criteria:

- project users can answer “how much traffic, what pages, where from” without raw SQL/logs.

### Slice 3: MVP+ Conversions

1. custom event capture (`event_type='custom'` + event name in payload)
2. configurable goals in analytics config
3. goal cards in dashboard

Exit criteria:

- project users can track at least one business action (e.g. CTA clicks or contact success page views).

## Testing Plan

Backend:

- ingest endpoint tests: token validation, entitlement gating, quota gating, payload normalization
- summary query tests: time range aggregation, top pages/referrers ordering
- superadmin router tests: ensure plugin instance on enable, analytics usage aggregation

Studio/OpenCode:

- tool module export tests
- tool registry enablement tests for `vivd_plugins_analytics_info`

Frontend:

- superadmin plugins tab tests for Analytics tab query wiring/actions
- project plugins analytics tab tests for loading/error/metrics render

## Rollout Plan

1. Ship behind feature flags:
   - `VIVD_ANALYTICS_PLUGIN_ENABLED` (backend/plugin catalog exposure)
   - OpenCode tool flags (`analytics`)
2. Internal superadmin pilot on a few projects.
3. Validate data quality (pageview counts roughly match external expectations).
4. Enable by default after pilot.

## Open Decisions

- Should MVP be fully cookieless-only, or support optional first-party cookie ids?
- Should query string capture be disabled hard by default (privacy-first), even in debug mode?
- Is country/device enrichment from headers sufficient, or do we require GeoIP integration later?
