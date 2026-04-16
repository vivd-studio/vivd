import type {
  PluginInfoSourcePayload,
  ProjectPluginInfoContractPayload,
  PluginCatalogEntry,
  PluginDefinition,
} from "@vivd/plugin-sdk";
export {
  PluginActionArgumentError,
  UnsupportedPluginActionError,
  UnsupportedPluginReadError,
} from "@vivd/plugin-sdk";

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
} from "@vivd/plugin-sdk";

function clonePlainObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getNotRequestedAccessState() {
  return {
    status: "not_requested" as const,
    requestedAt: null,
    requestedByUserId: null,
    requesterEmail: null,
  };
}

export function toPluginCatalogEntry<TPluginId extends string>(
  definition: PluginDefinition<TPluginId>,
): PluginCatalogEntry<TPluginId> {
  return {
    pluginId: definition.pluginId,
    kind: definition.kind,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    version: definition.version,
    sortOrder: definition.sortOrder,
    capabilities: definition.capabilities,
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
    accessRequest: getNotRequestedAccessState(),
  };
}
