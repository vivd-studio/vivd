import type { OrganizationPluginIssue, PluginSurfaceBadge } from "./surfaceTypes";
import type { PluginEntitlementState } from "./PluginEntitlementService";
import type { PluginId } from "./catalog";
import { analyticsPluginBackendHooks } from "./analytics/backendHooks";
import { contactFormPluginBackendHooks } from "./contactForm/backendHooks";
import { newsletterPluginBackendHooks } from "./newsletter/backendHooks";

export interface OrganizationPluginInstanceSnapshot {
  status: string | null;
  configJson: unknown;
}

export interface OrganizationPluginProjectIntegrationSummary {
  summaryLines: string[];
  badges: PluginSurfaceBadge[];
  issues: OrganizationPluginIssue[];
}

export interface BackendPluginProjectUsageCount {
  organizationId: string;
  projectSlug: string;
  count: number;
}

const backendPluginHooks = new Map<
  PluginId,
  {
    listProjectUsageCounts?: (options: {
      organizationId?: string;
      startedAt: Date;
    }) => Promise<BackendPluginProjectUsageCount[]>;
    buildOrganizationProjectSummaries?: (options: {
      organizationId: string;
      projectSlugs: string[];
      instancesByProjectSlug: Map<
        string,
        OrganizationPluginInstanceSnapshot | null
      >;
    }) => Promise<Map<string, OrganizationPluginProjectIntegrationSummary>>;
    prepareProjectEntitlementFields?: (options: {
      organizationId: string;
      projectSlug: string;
      state: PluginEntitlementState;
      turnstileEnabled: boolean;
      existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
    }) => Promise<PreparedPluginEntitlementFields>;
    cleanupProjectEntitlementFields?: (options: {
      state: PluginEntitlementState;
      turnstileEnabled: boolean;
      existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
    }) => Promise<void>;
  }
>([
  ["contact_form", contactFormPluginBackendHooks],
  ["analytics", analyticsPluginBackendHooks],
  ["newsletter", newsletterPluginBackendHooks],
]);

const organizationPluginHooks = new Map<
  PluginId,
  (options: {
    organizationId: string;
    projectSlugs: string[];
    instancesByProjectSlug: Map<string, OrganizationPluginInstanceSnapshot | null>;
  }) => Promise<Map<string, OrganizationPluginProjectIntegrationSummary>>
>(
  [...backendPluginHooks.entries()].flatMap(([pluginId, hooks]) =>
    hooks.buildOrganizationProjectSummaries
      ? [
          [
            pluginId,
            hooks.buildOrganizationProjectSummaries,
          ] as const,
        ]
      : [],
  ),
);

const pluginUsageHooks = new Map<
  PluginId,
  (options: {
    organizationId?: string;
    startedAt: Date;
  }) => Promise<BackendPluginProjectUsageCount[]>
>(
  [...backendPluginHooks.entries()].flatMap(([pluginId, hooks]) =>
    hooks.listProjectUsageCounts
      ? [
          [
            pluginId,
            hooks.listProjectUsageCounts,
          ] as const,
        ]
      : [],
  ),
);

export async function listPluginProjectUsageCounts(options: {
  pluginId: PluginId;
  organizationId?: string;
  startedAt: Date;
}): Promise<BackendPluginProjectUsageCount[]> {
  const hook = pluginUsageHooks.get(options.pluginId);
  if (!hook) return [];
  return hook(options);
}

export async function buildOrganizationPluginProjectSummaries(options: {
  pluginId: PluginId;
  organizationId: string;
  projectSlugs: string[];
  instancesByProjectSlug: Map<string, OrganizationPluginInstanceSnapshot | null>;
}): Promise<Map<string, OrganizationPluginProjectIntegrationSummary>> {
  const hook = organizationPluginHooks.get(options.pluginId);
  if (!hook) return new Map();
  return hook(options);
}

export interface SuperAdminPluginEntitlementSnapshot {
  turnstileWidgetId: string | null;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

export interface PreparedPluginEntitlementFields {
  turnstileEnabled: boolean;
  turnstileWidgetId: string | null;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

interface SuperAdminEntitlementHook {
  prepareProjectEntitlementFields(options: {
    organizationId: string;
    projectSlug: string;
    state: PluginEntitlementState;
    turnstileEnabled: boolean;
    existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
  }): Promise<PreparedPluginEntitlementFields>;
  cleanupProjectEntitlementFields(options: {
    state: PluginEntitlementState;
    turnstileEnabled: boolean;
    existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
  }): Promise<void>;
}

const superAdminEntitlementHooks = new Map<PluginId, SuperAdminEntitlementHook>(
  [...backendPluginHooks.entries()].flatMap(([pluginId, hooks]) => {
    const prepare = hooks.prepareProjectEntitlementFields;
    const cleanup = hooks.cleanupProjectEntitlementFields;
    if (!prepare || !cleanup) return [];

    return [
      [
        pluginId,
        {
          prepareProjectEntitlementFields: prepare,
          cleanupProjectEntitlementFields: cleanup,
        },
      ] as const,
    ];
  }),
);

export async function preparePluginProjectEntitlementFields(options: {
  pluginId: PluginId;
  organizationId: string;
  projectSlug: string;
  state: PluginEntitlementState;
  turnstileEnabled: boolean;
  existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
}): Promise<PreparedPluginEntitlementFields> {
  const hook = superAdminEntitlementHooks.get(options.pluginId);
  if (!hook) {
    return {
      turnstileEnabled: options.turnstileEnabled,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
    };
  }

  return hook.prepareProjectEntitlementFields(options);
}

export async function cleanupPluginProjectEntitlementFields(options: {
  pluginId: PluginId;
  state: PluginEntitlementState;
  turnstileEnabled: boolean;
  existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
}): Promise<void> {
  const hook = superAdminEntitlementHooks.get(options.pluginId);
  if (!hook) return;
  await hook.cleanupProjectEntitlementFields(options);
}
