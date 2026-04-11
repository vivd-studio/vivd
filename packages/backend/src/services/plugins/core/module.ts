import type {
  PluginInfoSourcePayload,
  ProjectPluginInfoContractPayload,
  PluginCatalogEntry,
  PluginDefinition,
} from "@vivd/shared/types";
export {
  PluginActionArgumentError,
  UnsupportedPluginActionError,
  UnsupportedPluginReadError,
} from "@vivd/shared/types";

export type {
  PluginModule,
  PluginOperationContext,
  PluginPublicErrorContext,
  PluginPublicErrorPayload,
  PluginReadContext,
  PluginUpdateConfigContext,
  ProjectPluginActionPayload,
  PluginInfoSourcePayload,
  ProjectPluginInfoContractPayload,
  ProjectPluginReadPayload,
} from "@vivd/shared/types";

function clonePlainObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function toPluginCatalogEntry<TPluginId extends string>(
  definition: PluginDefinition<TPluginId>,
): PluginCatalogEntry<TPluginId> {
  return {
    pluginId: definition.pluginId,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    version: definition.version,
    sortOrder: definition.sortOrder,
    capabilities: definition.capabilities,
    projectPanel: definition.listUi.projectPanel,
    usageLabel: definition.listUi.usageLabel,
    limitPrompt: definition.listUi.limitPrompt,
    supportsMonthlyLimit: definition.listUi.supportsMonthlyLimit,
    supportsHardStop: definition.listUi.supportsHardStop,
    supportsTurnstile: definition.listUi.supportsTurnstile,
    dashboardPath: definition.listUi.dashboardPath,
  };
}

export function buildPluginInfoContractPayload<TPluginId extends string>(
  definition: PluginDefinition<TPluginId>,
  payload: PluginInfoSourcePayload,
): ProjectPluginInfoContractPayload<TPluginId> {
  const catalog = toPluginCatalogEntry(definition);
  return {
    pluginId: definition.pluginId,
    catalog,
    capabilities: catalog.capabilities,
    entitled: payload.entitled,
    entitlementState: payload.entitlementState,
    enabled: payload.enabled,
    instanceId: payload.instanceId,
    status: payload.status,
    publicToken: payload.publicToken,
    config: payload.config,
    defaultConfig: clonePlainObject(definition.defaultConfig),
    snippets: payload.snippets,
    usage: payload.usage,
    details: payload.details,
    instructions: payload.instructions,
  };
}
