export type PluginActionArgumentType = "string" | "email";

export interface PluginActionArgumentDefinition {
  name: string;
  type: PluginActionArgumentType;
  required: boolean;
  description?: string;
}

export interface PluginActionDefinition {
  actionId: string;
  title: string;
  description: string;
  arguments: PluginActionArgumentDefinition[];
}

export interface PluginConfigCapabilityDefinition {
  format: "json";
  supportsShow: boolean;
  supportsApply: boolean;
  supportsTemplate: boolean;
}

export interface PluginCapabilityDefinition {
  supportsInfo: boolean;
  config: PluginConfigCapabilityDefinition | null;
  actions: PluginActionDefinition[];
}

export type PluginCategory = "forms" | "marketing" | "commerce" | "utility";
export type PluginProjectPanelKind = "custom" | "generic";

export interface PluginListUiDefinition {
  projectPanel: PluginProjectPanelKind;
  usageLabel: string;
  limitPrompt: string;
  supportsMonthlyLimit: boolean;
  supportsHardStop: boolean;
  supportsTurnstile: boolean;
  dashboardPath: string | null;
}

export interface PluginDefinition<TPluginId extends string = string> {
  pluginId: TPluginId;
  name: string;
  description: string;
  category: PluginCategory;
  version: number;
  sortOrder: number;
  configSchema: unknown;
  defaultConfig: Record<string, unknown>;
  defaultEnabledByProfile: {
    solo: boolean;
    platform: boolean;
  };
  capabilities: PluginCapabilityDefinition;
  listUi: PluginListUiDefinition;
}

export interface PluginCatalogEntry<TPluginId extends string = string> {
  pluginId: TPluginId;
  name: string;
  description: string;
  category: PluginCategory;
  version: number;
  sortOrder: number;
  capabilities: PluginCapabilityDefinition;
  projectPanel: PluginProjectPanelKind;
  usageLabel: string;
  limitPrompt: string;
  supportsMonthlyLimit: boolean;
  supportsHardStop: boolean;
  supportsTurnstile: boolean;
  dashboardPath: string | null;
}

export interface ProjectPluginInfoContractPayload<TPluginId extends string = string> {
  pluginId: TPluginId;
  catalog: PluginCatalogEntry<TPluginId>;
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

export interface ProjectPluginActionPayload<TPluginId extends string = string> {
  pluginId: TPluginId;
  actionId: string;
  summary: string;
  result: unknown;
}

export class UnsupportedPluginActionError extends Error {
  constructor(pluginId: string, actionId: string) {
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

export interface PluginModule<TPluginId extends string = string> {
  definition: PluginDefinition<TPluginId>;
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
  ): Promise<ProjectPluginActionPayload<TPluginId>>;
  mapPublicError?(
    context: PluginPublicErrorContext,
  ): PluginPublicErrorPayload | null;
}
