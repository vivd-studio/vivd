import {
  definePluginPackageDescriptors,
  extractPluginIds,
} from "@vivd/plugin-sdk";
import { installedPluginManifests } from "@vivd/installed-plugins";
import type {
  PluginCatalogEntry as SharedPluginCatalogEntry,
  PluginControlPlanePresentation as SharedPluginControlPlanePresentation,
  PluginDefinition as SharedPluginDefinition,
  PluginPackageManifest as SharedPluginPackageManifest,
} from "@vivd/plugin-sdk";

export const pluginPackageManifests =
  definePluginPackageDescriptors(installedPluginManifests);

export const PLUGIN_IDS = extractPluginIds(pluginPackageManifests);
export type PluginId = (typeof PLUGIN_IDS)[number];
export type PluginDefinition = SharedPluginDefinition<PluginId>;
export type PluginCatalogEntry = SharedPluginCatalogEntry<PluginId>;
export type PluginPackageManifest = SharedPluginPackageManifest<PluginId>;
export interface PluginControlPlaneCatalogEntry
  extends PluginCatalogEntry,
    SharedPluginControlPlanePresentation {}

const pluginManifestRegistry = Object.fromEntries(
  pluginPackageManifests.map((manifest) => [
    manifest.pluginId,
    manifest,
  ]),
) as unknown as Record<PluginId, PluginPackageManifest>;

const pluginRegistry = Object.fromEntries(
  Object.values(pluginManifestRegistry).map((manifest) => [
    manifest.pluginId,
    manifest.definition,
  ]),
) as Record<PluginId, PluginDefinition>;

const HOST_OWNED_PLUGIN_DEFAULT_ENABLEMENT_BY_PROFILE: Record<
  "solo" | "platform",
  Partial<Record<PluginId, boolean>>
> = {
  solo: {
    contact_form: true,
    analytics: true,
    google_maps: true,
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

function toPluginCatalogEntry(plugin: PluginDefinition): PluginCatalogEntry {
  return {
    pluginId: plugin.pluginId,
    kind: plugin.kind,
    name: plugin.name,
    description: plugin.description,
    category: plugin.category,
    version: plugin.version,
    sortOrder: plugin.sortOrder,
    capabilities: plugin.capabilities,
  };
}

function toPluginControlPlaneCatalogEntry(
  manifest: PluginPackageManifest,
): PluginControlPlaneCatalogEntry {
  return {
    ...toPluginCatalogEntry(manifest.definition),
    ...manifest.controlPlane,
  };
}

export function listPluginCatalogEntries(): PluginCatalogEntry[] {
  return listPluginDefinitions().map(toPluginCatalogEntry);
}

export function listPluginControlPlaneCatalogEntries(): PluginControlPlaneCatalogEntry[] {
  return Object.values(pluginManifestRegistry)
    .sort((left, right) => left.definition.sortOrder - right.definition.sortOrder)
    .map(toPluginControlPlaneCatalogEntry);
}

export function getPluginDefinition(pluginId: PluginId): PluginDefinition {
  return pluginRegistry[pluginId];
}

export function getPluginCatalogEntry(pluginId: PluginId): PluginCatalogEntry {
  return toPluginCatalogEntry(getPluginDefinition(pluginId));
}

export function getPluginControlPlaneCatalogEntry(
  pluginId: PluginId,
): PluginControlPlaneCatalogEntry {
  return toPluginControlPlaneCatalogEntry(getPluginManifest(pluginId));
}

export function getPluginManifest(pluginId: PluginId): PluginPackageManifest {
  return pluginManifestRegistry[pluginId];
}

export function getHostDefaultPluginEnabledForProfile(
  pluginId: PluginId,
  profile: "solo" | "platform",
): boolean {
  return HOST_OWNED_PLUGIN_DEFAULT_ENABLEMENT_BY_PROFILE[profile][pluginId] === true;
}
