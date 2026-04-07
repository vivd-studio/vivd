import type { PluginCapabilityDefinition } from "../capabilityContract";
import type {
  PluginCatalogEntry,
  PluginDefinition,
  PluginId,
} from "../registry";

export interface ProjectPluginInfoContractPayload {
  pluginId: PluginId;
  catalog: PluginCatalogEntry;
  capabilities: PluginCapabilityDefinition;
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: Record<string, unknown> | null;
  defaultConfig: Record<string, unknown>;
  snippets: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  instructions: string[];
}

export interface ProjectPluginActionPayload {
  pluginId: PluginId;
  actionId: string;
  summary: string;
  result: unknown;
}

export class UnsupportedPluginActionError extends Error {
  constructor(pluginId: PluginId, actionId: string) {
    super(`Plugin ${pluginId} does not support action "${actionId}"`);
    this.name = "UnsupportedPluginActionError";
  }
}

export class PluginActionArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginActionArgumentError";
  }
}

export interface PluginOperationContext {
  organizationId: string;
  projectSlug: string;
}

export interface PluginUpdateConfigContext extends PluginOperationContext {
  config: Record<string, unknown>;
}

export interface PluginActionContext extends PluginOperationContext {
  actionId: string;
  args: string[];
  requestedByUserId?: string | null;
  requestHost?: string | null;
}

export interface PluginInfoSourcePayload {
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: Record<string, unknown> | null;
  snippets: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  instructions: string[];
}

export type PluginPublicErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "INTERNAL_SERVER_ERROR";

export interface PluginPublicErrorPayload {
  code: PluginPublicErrorCode;
  message: string;
}

export interface PluginPublicErrorContext {
  operation: "info" | "updateConfig" | "runAction";
  error: unknown;
  actionId?: string;
}

export interface PluginModule {
  definition: PluginDefinition;
  ensureInstance(options: PluginOperationContext): Promise<{
    instanceId: string;
    created: boolean;
    status: string;
  }>;
  getInfoPayload(
    options: PluginOperationContext,
  ): Promise<PluginInfoSourcePayload>;
  updateConfig(
    options: PluginUpdateConfigContext,
  ): Promise<PluginInfoSourcePayload>;
  runAction?(
    options: PluginActionContext,
  ): Promise<ProjectPluginActionPayload>;
  mapPublicError?(
    context: PluginPublicErrorContext,
  ): PluginPublicErrorPayload | null;
}

function clonePlainObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function toPluginCatalogEntry(
  definition: PluginDefinition,
): PluginCatalogEntry {
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

export function buildPluginInfoContractPayload(
  definition: PluginDefinition,
  payload: PluginInfoSourcePayload,
): ProjectPluginInfoContractPayload {
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
