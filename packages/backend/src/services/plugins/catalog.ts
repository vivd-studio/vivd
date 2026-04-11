import {
  definePluginPackageDescriptors,
  extractPluginIds,
} from "@vivd/shared/types";
import type {
  PluginCatalogEntry as SharedPluginCatalogEntry,
  PluginDefinition as SharedPluginDefinition,
} from "@vivd/shared/types";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";

export const pluginPackageDescriptors = definePluginPackageDescriptors([
  contactFormPluginDescriptor,
  analyticsPluginDescriptor,
] as const);

export const PLUGIN_IDS = extractPluginIds(pluginPackageDescriptors);
export type PluginId = (typeof PLUGIN_IDS)[number];
export type PluginDefinition = SharedPluginDefinition<PluginId>;
export type PluginCatalogEntry = SharedPluginCatalogEntry<PluginId>;

const pluginRegistry = Object.fromEntries(
  pluginPackageDescriptors.map((descriptor) => [
    descriptor.pluginId,
    descriptor.definition,
  ]),
) as unknown as Record<PluginId, PluginDefinition>;

export function listPluginDefinitions(): PluginDefinition[] {
  return [...Object.values(pluginRegistry)].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
}

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

export function getPluginDefinition(pluginId: PluginId): PluginDefinition {
  return pluginRegistry[pluginId];
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
