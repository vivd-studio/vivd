import {
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./contactForm/module";
import {
  analyticsPluginConfigSchema,
  type AnalyticsPluginConfig,
} from "./analytics/module";
import type {
  PluginModule as SharedPluginModule,
} from "@vivd/shared/types";
import {
  backendPluginPackageDescriptors,
} from "./descriptors";
import {
  PLUGIN_IDS,
  getPluginCatalogEntry,
  getPluginDefinition,
  listPluginCatalogEntries,
  listPluginDefinitions,
  type PluginCatalogEntry,
  type PluginDefinition,
  type PluginId,
} from "./catalog";

export type PluginModule = SharedPluginModule<PluginId>;
export { contactFormPluginConfigSchema };
export type { ContactFormPluginConfig };
export { analyticsPluginConfigSchema };
export type { AnalyticsPluginConfig };
export {
  PLUGIN_IDS,
  getPluginCatalogEntry,
  getPluginDefinition,
  listPluginCatalogEntries,
  listPluginDefinitions,
};
export type { PluginCatalogEntry, PluginDefinition, PluginId };

const pluginModules = Object.fromEntries(
  backendPluginPackageDescriptors.map((descriptor) => [
    descriptor.pluginId,
    descriptor.backend.module,
  ]),
) as Record<PluginId, PluginModule>;

export function listPluginModules(): PluginModule[] {
  return listPluginDefinitions().map((plugin) => pluginModules[plugin.pluginId]);
}

export function getPluginModule(pluginId: PluginId): PluginModule {
  return pluginModules[pluginId];
}
export const getPluginManifest = getPluginDefinition;
