import {
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./contactForm/module";
import {
  analyticsPluginConfigSchema,
  type AnalyticsPluginConfig,
  analyticsPluginModule,
} from "./analytics/module";
import { contactFormPluginModule } from "./contactForm/module";
import type {
  PluginCatalogEntry as SharedPluginCatalogEntry,
  PluginDefinition as SharedPluginDefinition,
  PluginModule as SharedPluginModule,
} from "@vivd/shared/types";

export const PLUGIN_IDS = ["contact_form", "analytics"] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];
export type PluginDefinition = SharedPluginDefinition<PluginId>;
export type PluginCatalogEntry = SharedPluginCatalogEntry<PluginId>;
export type PluginModule = SharedPluginModule<PluginId>;
export { contactFormPluginConfigSchema };
export type { ContactFormPluginConfig };
export { analyticsPluginConfigSchema };
export type { AnalyticsPluginConfig };

const pluginModules: Record<PluginId, PluginModule> = {
  contact_form: contactFormPluginModule,
  analytics: analyticsPluginModule,
};

const pluginRegistry: Record<PluginId, PluginDefinition> = {
  contact_form: contactFormPluginModule.definition,
  analytics: analyticsPluginModule.definition,
};

export function listPluginCatalogEntries(): PluginCatalogEntry[] {
  return listPluginDefinitions().map((plugin) => ({
    pluginId: plugin.pluginId,
    name: plugin.name,
    description: plugin.description,
    category: plugin.category,
    version: plugin.version,
    sortOrder: plugin.sortOrder,
    capabilities: plugin.capabilities,
    projectPanel: plugin.listUi.projectPanel,
    usageLabel: plugin.listUi.usageLabel,
    limitPrompt: plugin.listUi.limitPrompt,
    supportsMonthlyLimit: plugin.listUi.supportsMonthlyLimit,
    supportsHardStop: plugin.listUi.supportsHardStop,
    supportsTurnstile: plugin.listUi.supportsTurnstile,
    dashboardPath: plugin.listUi.dashboardPath,
  }));
}

export function listPluginDefinitions(): PluginDefinition[] {
  return [...Object.values(pluginRegistry)].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
}

export function listPluginModules(): PluginModule[] {
  return listPluginDefinitions().map((plugin) => pluginModules[plugin.pluginId]);
}

export function getPluginDefinition(pluginId: PluginId): PluginDefinition {
  return pluginRegistry[pluginId];
}

export function getPluginModule(pluginId: PluginId): PluginModule {
  return pluginModules[pluginId];
}

export function getPluginCatalogEntry(pluginId: PluginId): PluginCatalogEntry {
  const definition = getPluginDefinition(pluginId);
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

export function getPluginDefaultEnabledByProfile(
  pluginId: PluginId,
  profile: "solo" | "platform",
): boolean {
  return pluginRegistry[pluginId].defaultEnabledByProfile[profile];
}

export const getPluginManifest = getPluginDefinition;
