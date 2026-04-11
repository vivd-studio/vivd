import type {
  OrganizationPluginIssue,
  PluginSurfaceBadge,
} from "./surfaceTypes";
import type { PluginEntitlementState } from "./PluginEntitlementService";
import type { PluginId } from "./registry";
import { backendPluginPackageDescriptors } from "./descriptors";

export interface OrganizationPluginInstanceSnapshot {
  status: string | null;
  configJson: unknown;
}

export interface OrganizationPluginProjectIntegrationSummary {
  summaryLines: string[];
  badges: PluginSurfaceBadge[];
  issues: OrganizationPluginIssue[];
}

const organizationPluginHooks = new Map<
  PluginId,
  (options: {
    organizationId: string;
    projectSlugs: string[];
    instancesByProjectSlug: Map<string, OrganizationPluginInstanceSnapshot | null>;
  }) => Promise<Map<string, OrganizationPluginProjectIntegrationSummary>>
>(
  backendPluginPackageDescriptors.flatMap((descriptor) =>
    descriptor.backend.hooks?.buildOrganizationProjectSummaries
      ? [
          [
            descriptor.pluginId as PluginId,
            descriptor.backend.hooks.buildOrganizationProjectSummaries,
          ] as const,
        ]
      : [],
  ),
);

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
  backendPluginPackageDescriptors.flatMap((descriptor) => {
    const prepare = descriptor.backend.hooks?.prepareProjectEntitlementFields;
    const cleanup = descriptor.backend.hooks?.cleanupProjectEntitlementFields;
    if (!prepare || !cleanup) return [];

    return [
      [
        descriptor.pluginId as PluginId,
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
