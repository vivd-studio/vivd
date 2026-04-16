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

export type PluginReadArgumentType = "string" | "integer" | "boolean";

export interface PluginReadArgumentDefinition {
  name: string;
  type: PluginReadArgumentType;
  required: boolean;
  description?: string;
  allowedValues?: Array<string | number | boolean>;
  defaultValue?: string | number | boolean;
}

export interface PluginReadDefinition {
  readId: string;
  title: string;
  description: string;
  arguments: PluginReadArgumentDefinition[];
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
  reads?: PluginReadDefinition[];
}

export type PluginKind = "native" | "external_embed" | "connected";
export type PluginCategory = "forms" | "marketing" | "commerce" | "utility";
export type PluginProjectPanelKind = "custom" | "generic";
export type PluginSetupAutomation = "none" | "partial" | "full";
export type PluginPreviewMode = "native" | "limited" | "none";
export type PluginPublishCheckSeverity = "warning" | "error";

export interface PluginSetupGuide {
  summary: string;
  automatedSetup: PluginSetupAutomation;
  instructions?: string[];
  docsUrl?: string;
}

export interface PluginPreviewSupport {
  mode: PluginPreviewMode;
  notes?: string;
}

export interface PluginPublishCheckDefinition {
  checkId: string;
  title: string;
  severity: PluginPublishCheckSeverity;
  description: string;
}

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
  kind: PluginKind;
  name: string;
  description: string;
  agentHints?: string[];
  category: PluginCategory;
  version: number;
  sortOrder: number;
  configSchema: unknown;
  defaultConfig: Record<string, unknown>;
  capabilities: PluginCapabilityDefinition;
  listUi: PluginListUiDefinition;
}

export interface PluginCatalogEntry<TPluginId extends string = string> {
  pluginId: TPluginId;
  kind?: PluginKind;
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

export interface ProjectPluginInfoContractPayload<
  TPluginId extends string = string,
> {
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

export interface ProjectPluginReadPayload<TPluginId extends string = string> {
  pluginId: TPluginId;
  readId: string;
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

export class UnsupportedPluginReadError extends Error {
  constructor(pluginId: string, readId: string) {
    super(`Plugin ${pluginId} does not support read "${readId}"`);
    this.name = "UnsupportedPluginReadError";
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

export interface PluginReadContext extends PluginOperationContext {
  readId: string;
  input: Record<string, unknown>;
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
  operation: "info" | "updateConfig" | "runAction" | "read";
  error: unknown;
  actionId?: string;
  readId?: string;
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
  runRead?(
    options: PluginReadContext,
  ): Promise<ProjectPluginReadPayload<TPluginId>>;
  mapPublicError?(
    context: PluginPublicErrorContext,
  ): PluginPublicErrorPayload | null;
}
