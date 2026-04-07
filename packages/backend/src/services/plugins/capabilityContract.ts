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
