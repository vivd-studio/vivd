import type { PluginStopFn } from "@vivd/plugin-sdk";
import type { OrganizationPluginIssue, PluginSurfaceBadge } from "./surfaceTypes";
import type { PluginEntitlementState } from "./PluginEntitlementService";
import type { PluginId } from "./catalog";
import {
  backendPluginPackageDescriptors,
  type BackendPluginIntegrationHooks,
} from "./descriptors";

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
  BackendPluginIntegrationHooks
>(
  backendPluginPackageDescriptors.flatMap((descriptor) =>
    descriptor.backend.hooks
      ? [[descriptor.pluginId as PluginId, descriptor.backend.hooks] as const]
      : [],
  ),
);

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

const projectSlugRenameHooks = new Map<
  PluginId,
  NonNullable<BackendPluginIntegrationHooks["renameProjectSlugData"]>
>(
  [...backendPluginHooks.entries()].flatMap(([pluginId, hooks]) =>
    hooks.renameProjectSlugData
      ? [[pluginId, hooks.renameProjectSlugData] as const]
      : [],
  ),
);

const backgroundJobHooks = new Map<
  PluginId,
  NonNullable<BackendPluginIntegrationHooks["startBackgroundJobs"]>
>(
  [...backendPluginHooks.entries()].flatMap(([pluginId, hooks]) =>
    hooks.startBackgroundJobs
      ? [[pluginId, hooks.startBackgroundJobs] as const]
      : [],
  ),
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

export async function renamePluginProjectDataForSlugChange(options: {
  tx: {
    update(table: any): any;
  };
  organizationId: string;
  oldSlug: string;
  newSlug: string;
}): Promise<number> {
  let movedRows = 0;
  for (const hook of projectSlugRenameHooks.values()) {
    movedRows += await hook(options);
  }
  return movedRows;
}

function normalizePluginStopFns(
  result: void | PluginStopFn | readonly PluginStopFn[],
): PluginStopFn[] {
  if (!result) return [];
  if (Array.isArray(result)) {
    return result.filter((stop): stop is PluginStopFn => typeof stop === "function");
  }
  return typeof result === "function" ? [result] : [];
}

export function startInstalledPluginBackgroundJobs(): PluginStopFn {
  const stopFns = [...backgroundJobHooks.values()].flatMap((hook) =>
    normalizePluginStopFns(hook()),
  );
  let stopped = false;

  return () => {
    if (stopped) return;
    stopped = true;
    for (const stop of stopFns) {
      stop();
    }
  };
}
