import type { PluginBundleEntry } from "@vivd/plugin-sdk";
import { definePluginBundleEntry } from "@vivd/plugin-sdk";
import { analyticsPluginManifest } from "./manifest";

export const analyticsPluginDescriptor =
  definePluginBundleEntry({
    pluginId: analyticsPluginManifest.pluginId,
    manifest: analyticsPluginManifest,
    surfaceExports: {
      backend: "@vivd/plugin-analytics/backend/plugin",
      frontend: "@vivd/plugin-analytics/frontend/plugin",
      cli: "@vivd/plugin-analytics/cli/plugin",
    },
  } as const satisfies PluginBundleEntry<"analytics">);

export default analyticsPluginDescriptor;
