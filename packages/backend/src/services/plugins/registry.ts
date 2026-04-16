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
} from "@vivd/plugin-sdk";
import {
  backendPluginPackageDescriptors,
} from "./descriptors";
import {
  PLUGIN_IDS,
  getPluginCatalogEntry,
  getPluginControlPlaneCatalogEntry,
  getPluginDefinition,
  getPluginManifest,
  listPluginCatalogEntries,
  listPluginControlPlaneCatalogEntries,
  listPluginDefinitions,
  type PluginControlPlaneCatalogEntry,
  type PluginCatalogEntry,
  type PluginDefinition,
  type PluginId,
  type PluginPackageManifest,
} from "./catalog";

export type PluginModule = SharedPluginModule<PluginId>;
export { contactFormPluginConfigSchema };
export type { ContactFormPluginConfig };
export { analyticsPluginConfigSchema };
export type { AnalyticsPluginConfig };
export {
  PLUGIN_IDS,
  getPluginCatalogEntry,
  getPluginControlPlaneCatalogEntry,
  getPluginDefinition,
  getPluginManifest,
  listPluginCatalogEntries,
  listPluginControlPlaneCatalogEntries,
  listPluginDefinitions,
};
export type {
  PluginCatalogEntry,
  PluginControlPlaneCatalogEntry,
  PluginDefinition,
  PluginId,
  PluginPackageManifest,
};

const pluginModules = Object.fromEntries(
  []
) as Record<PluginId, PluginModule>;

let pluginModulesInitialized = false;

function getPluginModulesRecord(): Record<PluginId, PluginModule> {
  if (!pluginModulesInitialized) {
    Object.assign(
      pluginModules,
      Object.fromEntries(
        backendPluginPackageDescriptors.map((descriptor) => [
          descriptor.pluginId,
          descriptor.backend.module,
        ]),
      ),
    );
    pluginModulesInitialized = true;
  }

  return pluginModules;
}

export function listPluginModules(): PluginModule[] {
  const modules = getPluginModulesRecord();
  return listPluginDefinitions().map((plugin) => modules[plugin.pluginId]);
}

export function getPluginModule(pluginId: PluginId): PluginModule {
  return getPluginModulesRecord()[pluginId];
}
