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

export interface PluginCliModule {
  pluginId: string;
  aliases?: PluginCliAliasDefinition[];
  help?: PluginCliHelpDefinition;
  renderInfo?(
    info: PluginCliInfoContractPayload,
  ): PluginCliRenderResult;
}
