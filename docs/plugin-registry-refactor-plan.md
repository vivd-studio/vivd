# Plugin Registry Surface Refactor Plan

Date: 2026-04-06  
Owner: backend + frontend + studio  
Status: proposed implementation plan

This document turns the existing plugin-architecture review into a concrete refactor plan for the next step: making first-party plugins show up automatically in the main listing surfaces without duplicating plugin metadata and list wiring in multiple places.

It complements [docs/plugin-system-design.md](./plugin-system-design.md), which describes the broader plugin platform. This plan is narrower: registry-driven discovery, summaries, and UI composition across the control plane.

## Problem Statement

Vivd already has a code-defined plugin registry in `packages/backend/src/services/plugins/registry.ts`, and `vivd plugins catalog` / the backend catalog flow already read from it.

The main control-plane listing surfaces do not:

- Super Admin plugins uses a frontend-local `SUPERADMIN_PLUGIN_LIST` and one query per known plugin.
- Organization plugins overview hardcodes Contact Form and Analytics columns.
- Project plugins uses the catalog for names/descriptions, but still renders explicit Contact Form and Analytics cards and separate plugin-specific queries.
- Instance plugin defaults in `InstallProfileService` still define plugin keys explicitly instead of deriving from the registry.

Today, adding a new plugin to the registry does not make it appear automatically in:

- Super Admin -> Plugins
- Organization -> Plugins
- Project -> Plugins

## Goals

- Adding a new first-party plugin to the registry should make it appear automatically in all three listing surfaces and in `vivd plugins catalog`.
- Plugin labels, descriptions, categories, ordering, generic status labels, and usage-unit metadata should come from one source of truth.
- Rich plugin-specific configuration UIs should remain possible without forcing all plugins into a weak schema-driven form system.
- Backend summary/list APIs should be bulk-oriented by plugin, not per-project/per-plugin N+1 calls.
- The UI should scale beyond two plugins without adding another dedicated column or query branch each time.

## Non-Goals

- Third-party plugin marketplace or arbitrary plugin execution.
- Fully schema-driven plugin settings forms.
- Automatic generation of plugin-specific CLI subcommands.
- Replacing the existing plugin-specific runtime/services for Contact Form or Analytics.

## Definition Of Done

The refactor is complete when all of the following are true:

- A new plugin added to the registry appears in Super Admin, Organization Plugins, Project Plugins, and `vivd plugins catalog` without editing a frontend-local plugin list.
- All three listing surfaces iterate backend-returned plugin collections instead of hardcoded plugin fields or plugin-specific columns.
- Contact Form and Analytics still render their richer custom project panels.
- Generic fallback UI exists for plugins that have no custom panel yet.
- Instance plugin defaults and other plugin-keyed policy maps are derived from registry plugin IDs rather than handwritten object literals.

## Key Decisions

### 1. Separate registry-driven listing from plugin-specific detail panels

Automatic appearance should apply to discovery/listing surfaces.

Deep configuration remains plugin-specific:

- Contact Form keeps a custom config/editor panel.
- Analytics keeps its lightweight project panel plus dashboard link.
- Future plugins can ship either:
  - a custom project panel component
  - or no custom panel, in which case the project page still shows a generic card

This keeps the main surfaces generic without forcing a premature generic config-form system.

### 2. Use one generic status model across all listing surfaces

Every list surface should use the same high-level install state:

- `disabled`: plugin is not entitled for the project
- `available`: plugin is entitled but no project plugin instance exists yet
- `enabled`: plugin instance exists and is active
- `suspended`: entitlement or access is suspended

Operational issues are separate from install state:

- missing recipients
- pending verification
- credentials not ready
- usage limit reached

Those belong in `issues[]` and `badges[]`, not in a plugin-specific status enum per page.

### 3. Keep the backend registry as the source of truth for list metadata

The registry should own:

- `pluginId`
- display name
- short description
- category
- version
- list order
- generic UI capabilities
- usage-unit label
- whether the plugin exposes a project dashboard link

Frontend-local plugin constants should be removed.

### 4. Do not block phase 1 on a `plugin_entitlement` schema migration

The current `plugin_entitlement` table still leaks Contact Form-specific Turnstile fields:

- `turnstileEnabled`
- `turnstileWidgetId`
- `turnstileSiteKey`
- `turnstileSecretKey`

Those fields are a real architectural smell, but they do not block the listing refactor.

Recommended sequencing:

- Phase 1: keep the current columns, but hide them behind Contact Form summary/policy adapters.
- Phase 2: add a generic `policyJson` field if a third plugin needs plugin-specific entitlement settings.

This keeps the first refactor focused on discovery and UI composition instead of mixing it with avoidable DB churn.

## Target Shared Contracts

Create shared surface contracts in `packages/shared/src/plugins/contracts.ts`.

The backend registry remains executable/backend-owned. The shared package only needs the DTOs that backend and frontend agree on.

```ts
export type PluginId = "contact_form" | "analytics";

export type PluginInstallState =
  | "disabled"
  | "available"
  | "enabled"
  | "suspended";

export type PluginIssueSeverity = "info" | "warning" | "error";

export interface PluginCatalogEntry {
  pluginId: PluginId;
  name: string;
  shortDescription: string;
  category: "forms" | "marketing" | "commerce" | "utility";
  version: number;
  sortOrder: number;
  projectPanel: "custom" | "generic";
  dashboardPathTemplate?: string | null;
  usageUnitLabel?: string | null;
  supportsMonthlyLimit: boolean;
  supportsHardStop: boolean;
}

export interface PluginBadge {
  key: string;
  label: string;
  tone: "default" | "success" | "secondary" | "warning" | "destructive";
}

export interface PluginIssue {
  code: string;
  severity: PluginIssueSeverity;
  message: string;
}

export interface PluginEntitlementSummary {
  scope: "instance" | "organization" | "project" | "none";
  state: "disabled" | "enabled" | "suspended";
  managedBy: "manual_superadmin" | "plan" | "self_serve";
}

export interface PluginInstanceSummary {
  instanceId: string | null;
  status: "enabled" | "disabled" | null;
  updatedAt: string | null;
}

export interface PluginUsageSummary {
  thisMonth: number | null;
  monthlyLimit: number | null;
  unitLabel: string | null;
  hardStop: boolean | null;
}

export interface ProjectPluginListItem {
  pluginId: PluginId;
  catalog: PluginCatalogEntry;
  installState: PluginInstallState;
  entitled: boolean;
  entitlement: PluginEntitlementSummary;
  instance: PluginInstanceSummary;
  usage: PluginUsageSummary | null;
  badges: PluginBadge[];
  issues: PluginIssue[];
}

export interface OrganizationProjectPluginsRow {
  projectSlug: string;
  projectTitle: string;
  updatedAt: string;
  deployedDomain: string | null;
  plugins: ProjectPluginListItem[];
  issues: PluginIssue[];
}

export interface SuperAdminProjectPluginsRow {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  projectSlug: string;
  projectTitle: string;
  isDeployed: boolean;
  deployedDomain: string | null;
  updatedAt: string | null;
  plugins: ProjectPluginListItem[];
}
```

## Backend Registry Contract

Expand `packages/backend/src/services/plugins/registry.ts` from a manifest-only registry to a richer definition shape.

Recommended backend-only type:

```ts
export interface PluginDefinition {
  pluginId: PluginId;
  name: string;
  shortDescription: string;
  category: PluginCategory;
  version: number;
  sortOrder: number;
  configSchema: z.ZodTypeAny;
  defaultConfig: Record<string, unknown>;
  listUi: {
    projectPanel: "custom" | "generic";
    dashboardPathTemplate?: string | null;
    usageUnitLabel?: string | null;
    supportsMonthlyLimit: boolean;
    supportsHardStop: boolean;
  };
}
```

The registry should export:

- `PLUGIN_IDS`
- `PluginId`
- `listPluginDefinitions()`
- `listPluginCatalogEntries()`
- `getPluginDefinition(pluginId)`

`InstallProfileService` and any future plugin-keyed policy helpers should iterate `PLUGIN_IDS` or `listPluginDefinitions()`, not handwritten object literals.

## Backend Summary Adapters

Add one plugin-specific summary adapter per plugin so registry-driven surfaces can stay generic without flattening plugin behavior.

Recommended new backend files:

- `packages/backend/src/services/plugins/surfaces/types.ts`
- `packages/backend/src/services/plugins/surfaces/index.ts`
- `packages/backend/src/services/plugins/contactForm/surfaceAdapter.ts`
- `packages/backend/src/services/plugins/analytics/surfaceAdapter.ts`

Recommended interface:

```ts
export interface PluginSurfaceAdapter {
  pluginId: PluginId;

  buildProjectListItems(input: {
    organizationId: string;
    projectSlugs: string[];
  }): Promise<Map<string, ProjectPluginListItem>>;

  buildOrganizationOverview(input: {
    organizationId: string;
    projectSlugs: string[];
  }): Promise<Map<string, ProjectPluginListItem>>;

  buildSuperAdminListItems(input: {
    organizationId?: string;
    search?: string;
    state?: "disabled" | "enabled" | "suspended";
  }): Promise<Map<string, ProjectPluginListItem>>;
}
```

Notes:

- The adapter methods should be bulk-oriented by plugin.
- One query bundle per plugin is acceptable in phase 1 because plugin count is small.
- Avoid N+1 per project.

## API Shape Changes

### Project plugins catalog

Current behavior:

- returns `available` from the registry
- returns `instances`
- project page then makes separate plugin-specific info calls and hardcodes Contact Form / Analytics cards

Target behavior:

```ts
interface ProjectPluginsCatalogPayload {
  project: {
    organizationId: string;
    slug: string;
  };
  plugins: ProjectPluginListItem[];
}
```

The project page should be able to render the list view entirely from `plugins[]`.

Plugin-specific info endpoints can remain for the custom detail panels:

- `plugins.contactInfo`
- `plugins.analyticsInfo`

### Organization overview

Current behavior:

- fixed `contactForm` field
- fixed `analytics` field

Target behavior:

```ts
interface OrganizationPluginsOverviewPayload {
  rows: OrganizationProjectPluginsRow[];
}
```

### Super Admin access view

Current behavior:

- one request per plugin ID
- frontend merges rows itself

Target behavior:

```ts
interface SuperAdminPluginsListPayload {
  rows: SuperAdminProjectPluginsRow[];
  total: number;
}
```

Allow `pluginId` as an optional filter, not the default way the main page assembles data.

## Frontend Composition Model

### Super Admin

Keep the current high-level UX:

- one row per project
- stacked plugin cards inside the row
- bulk actions at project level

Refactor needed:

- remove `SUPERADMIN_PLUGIN_LIST`
- stop issuing one query per known plugin
- render `row.plugins.map(...)`

This layout is already extensible enough for a small-to-medium plugin count.

### Organization Overview

Change the layout.

The current design uses one dedicated table column per plugin, which will not scale.

Recommended replacement:

- keep one row per project
- replace `Contact Form` and `Analytics` columns with one `Plugins` column
- render compact plugin chips or stacked mini-cards inside that cell
- keep `Issues` and `Actions` columns

This is the only surface where the current layout should change materially.

### Project Plugins

Keep the card-based layout.

Recommended model:

- generic card shell for every plugin returned by the backend
- plugin-specific inner panel renderer for plugins that register one
- generic fallback body if no custom panel exists

This keeps the UX familiar while making the page registry-driven.

## Frontend Renderer Registration

Add a small frontend registry for custom panels.

Recommended new files:

- `packages/frontend/src/plugins/renderers.tsx`
- `packages/frontend/src/plugins/projectPanels/ContactFormPanel.tsx`
- `packages/frontend/src/plugins/projectPanels/AnalyticsPanel.tsx`

Recommended contract:

```ts
export interface ProjectPluginPanelProps {
  projectSlug: string;
  plugin: ProjectPluginListItem;
}

export type ProjectPluginPanelRenderer =
  React.ComponentType<ProjectPluginPanelProps>;

export const projectPluginPanelRenderers: Partial<
  Record<PluginId, ProjectPluginPanelRenderer>
>;
```

`ProjectPlugins.tsx` should:

- iterate over `catalogQuery.data.plugins`
- render a generic header/status shell for each item
- mount a custom renderer if one exists
- otherwise render a generic fallback body

## File-By-File Change Plan

### Shared contracts

| Path | Change |
| --- | --- |
| `packages/shared/src/plugins/contracts.ts` | New shared DTOs for plugin list surfaces and generic status/badge/issue types. |
| `packages/shared/src/plugins/index.ts` | New export barrel if useful for backend/frontend imports. |

### Backend core

| Path | Change |
| --- | --- |
| `packages/backend/src/services/plugins/registry.ts` | Enrich registry definitions with sort order, list UI metadata, and shared catalog serialization. |
| `packages/backend/src/services/plugins/ProjectPluginService.ts` | Replace `available + instances` catalog output with `plugins[]` summary assembly; keep plugin-specific ensure/info/update methods. |
| `packages/backend/src/services/plugins/PluginEntitlementService.ts` | Add generic helpers for project-level plugin access summaries and any bulk access retrieval needed by list surfaces. |
| `packages/backend/src/services/system/InstallProfileService.ts` | Derive plugin defaults from registry IDs instead of explicit `contact_form` / `analytics` object shapes. |

### Backend surface adapters

| Path | Change |
| --- | --- |
| `packages/backend/src/services/plugins/surfaces/types.ts` | New adapter contracts and shared backend summary helpers. |
| `packages/backend/src/services/plugins/surfaces/index.ts` | New adapter registry that maps plugin IDs to summary builders. |
| `packages/backend/src/services/plugins/contactForm/surfaceAdapter.ts` | New bulk summary builder for Contact Form list states, badges, and issues. |
| `packages/backend/src/services/plugins/analytics/surfaceAdapter.ts` | New bulk summary builder for Analytics list states, badges, and usage summaries. |

### Backend routers

| Path | Change |
| --- | --- |
| `packages/backend/src/trpcRouters/plugins/catalog.ts` | Return generic `plugins[]` payload for project list surfaces. |
| `packages/backend/src/trpcRouters/plugins/index.ts` | Keep plugin-specific deep endpoints, but ensure the main catalog route is the generic list source of truth. |
| `packages/backend/src/trpcRouters/organization.ts` | Replace fixed Contact Form / Analytics overview payload with `plugins[]` per project row. |
| `packages/backend/src/trpcRouters/superadmin.ts` | Replace one-plugin-at-a-time list assembly with one generic response containing all plugin summaries per project. |

### Frontend control-plane

| Path | Change |
| --- | --- |
| `packages/frontend/src/components/admin/plugins/PluginsTab.tsx` | Remove `SUPERADMIN_PLUGIN_LIST`, consume generic `plugins[]`, keep the existing row/card UX. |
| `packages/frontend/src/components/organization/OrganizationPluginsTab.tsx` | Replace fixed plugin columns with one scalable `Plugins` column plus generic badges/issues. |
| `packages/frontend/src/pages/ProjectPlugins.tsx` | Convert to generic card iteration and delegate deep plugin content to per-plugin renderers. |
| `packages/frontend/src/plugins/renderers.tsx` | New map of `pluginId -> custom renderer`. |
| `packages/frontend/src/plugins/projectPanels/ContactFormPanel.tsx` | Extract current Contact Form project panel out of `ProjectPlugins.tsx`. |
| `packages/frontend/src/plugins/projectPanels/AnalyticsPanel.tsx` | Extract current Analytics project panel out of `ProjectPlugins.tsx`. |

### Agent/CLI wording follow-up

| Path | Change |
| --- | --- |
| `packages/backend/src/services/agent/AgentInstructionsService.ts` | Keep catalog-first guidance, but avoid wording that suggests only Contact Form and Analytics are meaningful plugins. |
| `packages/studio/server/services/agent/AgentInstructionsService.ts` | Same wording cleanup for Studio agent instructions. |
| `packages/cli/src/commands.ts` | Optional follow-up: ensure `vivd plugins catalog` formatting uses the enriched registry metadata cleanly. |

### Storage follow-up, not required for phase 1

| Path | Change |
| --- | --- |
| `packages/backend/src/db/schema.ts` | Phase 2 only: consider `policyJson` on `plugin_entitlement` so plugin-specific entitlement settings stop leaking into shared columns. |
| `packages/backend/drizzle/*` | Phase 2 only: migration for `policyJson` and eventual Turnstile-field cleanup if/when needed. |

## Recommended Sequencing

### Phase 1: contracts and registry metadata

- Add shared DTOs.
- Expand backend registry definitions.
- Refactor `InstallProfileService` to derive plugin defaults from registry IDs.

### Phase 2: backend generic list payloads

- Introduce plugin summary adapters.
- Refactor project catalog, organization overview, and super-admin list payloads.
- Keep frontend compatibility temporarily if needed behind adapter functions.

### Phase 3: frontend generic rendering

- Convert Super Admin to generic plugin cards.
- Convert Organization Overview to a scalable plugins column.
- Convert Project Plugins to generic card shells plus custom panel renderers.

### Phase 4: cleanup and follow-up

- Remove old hardcoded plugin constants and one-query-per-plugin wiring.
- Adjust agent-instruction wording.
- Decide whether `plugin_entitlement` needs `policyJson` before the next plugin with custom access controls lands.

## Validation Plan

Run the smallest high-signal checks that match the touched files.

Backend:

- `npm run typecheck -w @vivd/backend`
- `npm run test:run -w @vivd/backend -- test/project_plugin_service.test.ts test/superadmin_router.test.ts`
- Add or extend organization overview router coverage if the generic payload replaces the current shape

Frontend:

- `npm run typecheck -w @vivd/frontend`
- `npm run test:run -w @vivd/frontend -- src/components/admin/plugins/PluginsTab.test.tsx src/components/organization/OrganizationPluginsTab.test.tsx src/pages/ProjectPlugins.test.tsx`

Shared:

- `npm run typecheck -w @vivd/shared`

## Open Questions

- Do we want the super-admin page to support filtering by plugin after the generic response lands, or is project-level filtering enough for now?
- Should the organization overview show only enabled/attention plugins, or every registered plugin including disabled ones?
- If the next plugin needs custom entitlement settings, do we migrate directly to `policyJson`, or tolerate one more plugin-specific shared-column leak first?

## Recommendation

Implement phase 1 through phase 3 now, and keep the `plugin_entitlement` storage cleanup as a clearly named phase 2 follow-up unless a third plugin with custom entitlement policy is already imminent.

That sequence solves the actual user-facing problem first:

- new plugins appear automatically everywhere they should
- the UI scales beyond two plugins
- Contact Form and Analytics keep their richer experiences

without turning the change into a larger-than-necessary platform rewrite.
