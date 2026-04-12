export interface PluginCliActionArgumentDefinition {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface PluginCliActionDefinition {
  actionId: string;
  title: string;
  description: string;
  arguments: PluginCliActionArgumentDefinition[];
}

export interface PluginCliReadArgumentDefinition {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface PluginCliReadDefinition {
  readId: string;
  title: string;
  description: string;
  arguments: PluginCliReadArgumentDefinition[];
}

export interface PluginCliConfigCapability {
  supportsShow: boolean;
  supportsApply: boolean;
  supportsTemplate: boolean;
}

export interface PluginCliCatalogEntry {
  pluginId: string;
  name: string;
  description: string;
  capabilities: {
    supportsInfo: boolean;
    config: PluginCliConfigCapability | null;
    actions: PluginCliActionDefinition[];
    reads?: PluginCliReadDefinition[];
  };
}

export interface PluginCliInfoContractPayload {
  pluginId: string;
  catalog: PluginCliCatalogEntry;
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

export type PluginCliAliasTarget =
  | { kind: "info" }
  | { kind: "config_show" }
  | { kind: "config_template" }
  | { kind: "config_apply" }
  | { kind: "action"; actionId: string };

export interface PluginCliAliasDefinition {
  tokens: string[];
  target: PluginCliAliasTarget;
  renderMode?: "auto" | "generic" | "plugin";
}

export interface PluginCliHelpDefinition {
  topic: string;
  lines: string[];
  summaryLines?: string[];
}

export interface PluginCliRenderResult {
  data: unknown;
  human: string;
}

export interface PluginCliRenderConfigContext {
  info: PluginCliInfoContractPayload;
  projectSlug: string;
}

export interface PluginCliRenderConfigTemplateContext {
  info: PluginCliInfoContractPayload | null;
}

export interface PluginCliRenderConfigUpdateContext {
  info: PluginCliInfoContractPayload;
  projectSlug: string;
}

export interface PluginCliActionResultPayload {
  pluginId: string;
  actionId: string;
  summary: string;
  result: unknown;
}

export interface PluginCliReadResultPayload {
  pluginId: string;
  readId: string;
  result: unknown;
}

export interface PluginCliModule {
  pluginId: string;
  aliases?: PluginCliAliasDefinition[];
  help?: PluginCliHelpDefinition;
  genericRendererModes?: {
    info?: boolean;
    config?: boolean;
    configTemplate?: boolean;
    configUpdate?: boolean;
    action?: boolean;
  };
  renderInfo?(
    info: PluginCliInfoContractPayload,
  ): PluginCliRenderResult;
  renderConfig?(
    context: PluginCliRenderConfigContext,
  ): PluginCliRenderResult;
  renderConfigTemplate?(
    context: PluginCliRenderConfigTemplateContext,
  ): PluginCliRenderResult;
  renderConfigUpdate?(
    context: PluginCliRenderConfigUpdateContext,
  ): PluginCliRenderResult;
  renderAction?(
    action: PluginCliActionResultPayload,
  ): PluginCliRenderResult | null;
}
