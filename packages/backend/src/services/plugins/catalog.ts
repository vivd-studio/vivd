import {
  definePluginPackageDescriptors,
  extractPluginIds,
} from "@vivd/plugin-sdk";
import { installedPluginManifests } from "@vivd/installed-plugins";
import type {
  PluginCatalogEntry as SharedPluginCatalogEntry,
  PluginDefinition as SharedPluginDefinition,
} from "@vivd/plugin-sdk";

export const pluginPackageDescriptors =
  definePluginPackageDescriptors(installedPluginManifests);

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

const HOST_OWNED_PLUGIN_DEFAULT_ENABLEMENT_BY_PROFILE: Record<
  "solo" | "platform",
  Partial<Record<PluginId, boolean>>
> = {
  solo: {
    contact_form: true,
    analytics: true,
    newsletter: true,
    table_booking: true,
  },
  platform: {},
};

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

export function getHostDefaultPluginEnabledForProfile(
  pluginId: PluginId,
  profile: "solo" | "platform",
): boolean {
  return HOST_OWNED_PLUGIN_DEFAULT_ENABLEMENT_BY_PROFILE[profile][pluginId] === true;
}

export const getPluginManifest = getPluginDefinition;
