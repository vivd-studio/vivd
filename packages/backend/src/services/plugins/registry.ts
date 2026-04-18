import {
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "@vivd/plugin-contact-form/backend/module";
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
  backendPluginPackageDescriptors.map((descriptor) => [
    descriptor.pluginId,
    descriptor.backend.module,
  ]),
) as Partial<Record<PluginId, PluginModule>>;

export function listPluginModules(): PluginModule[] {
  return listPluginDefinitions().flatMap((plugin) =>
    pluginModules[plugin.pluginId] ? [pluginModules[plugin.pluginId]!] : [],
  );
}

export function getOptionalPluginModule(pluginId: PluginId): PluginModule | null {
  return pluginModules[pluginId] ?? null;
}

export function getPluginModule(pluginId: PluginId): PluginModule {
  const module = getOptionalPluginModule(pluginId);
  if (!module) {
    throw new Error(`Plugin ${pluginId} does not expose a backend module`);
  }
  return module;
}
