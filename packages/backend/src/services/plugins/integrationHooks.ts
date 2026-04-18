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

function listBackendPluginHookEntries(): Array<
  readonly [PluginId, BackendPluginIntegrationHooks]
> {
  // Resolve hook descriptors lazily so plugin host context initialization can
  // finish before we touch the installed backend registry.
  return (backendPluginPackageDescriptors ?? []).flatMap((descriptor) =>
    descriptor.backend.hooks
      ? [[descriptor.pluginId as PluginId, descriptor.backend.hooks] as const]
      : [],
  );
}

export async function listPluginProjectUsageCounts(options: {
  pluginId: PluginId;
  organizationId?: string;
  startedAt: Date;
}): Promise<BackendPluginProjectUsageCount[]> {
  const hook = listBackendPluginHookEntries().find(
    ([pluginId, hooks]) =>
      pluginId === options.pluginId && hooks.listProjectUsageCounts,
  )?.[1].listProjectUsageCounts;
  if (!hook) return [];
  return hook(options);
}

export async function buildOrganizationPluginProjectSummaries(options: {
  pluginId: PluginId;
  organizationId: string;
  projectSlugs: string[];
  instancesByProjectSlug: Map<string, OrganizationPluginInstanceSnapshot | null>;
}): Promise<Map<string, OrganizationPluginProjectIntegrationSummary>> {
  const hook = listBackendPluginHookEntries().find(
    ([pluginId, hooks]) =>
      pluginId === options.pluginId && hooks.buildOrganizationProjectSummaries,
  )?.[1].buildOrganizationProjectSummaries;
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

function getSuperAdminEntitlementHook(
  pluginId: PluginId,
): SuperAdminEntitlementHook | null {
  const hooks = listBackendPluginHookEntries().find(
    ([candidatePluginId]) => candidatePluginId === pluginId,
  )?.[1];
  const prepare = hooks?.prepareProjectEntitlementFields;
  const cleanup = hooks?.cleanupProjectEntitlementFields;
  if (!prepare || !cleanup) return null;

  return {
    prepareProjectEntitlementFields: prepare,
    cleanupProjectEntitlementFields: cleanup,
  };
}

export async function preparePluginProjectEntitlementFields(options: {
  pluginId: PluginId;
  organizationId: string;
  projectSlug: string;
  state: PluginEntitlementState;
  turnstileEnabled: boolean;
  existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
}): Promise<PreparedPluginEntitlementFields> {
  const hook = getSuperAdminEntitlementHook(options.pluginId);
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
  const hook = getSuperAdminEntitlementHook(options.pluginId);
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
  for (const [, hooks] of listBackendPluginHookEntries()) {
    if (!hooks.renameProjectSlugData) continue;
    movedRows += await hooks.renameProjectSlugData(options);
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
  const stopFns = listBackendPluginHookEntries().flatMap(([, hooks]) =>
    hooks.startBackgroundJobs
      ? normalizePluginStopFns(hooks.startBackgroundJobs())
      : [],
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
