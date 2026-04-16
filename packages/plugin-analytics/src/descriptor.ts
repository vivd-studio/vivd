import type { PluginPackageInstallDescriptor } from "@vivd/plugin-sdk";
import { definePluginPackageInstallDescriptor } from "@vivd/plugin-sdk";
import { analyticsPluginManifest } from "./manifest";

export const analyticsPluginDescriptor =
  definePluginPackageInstallDescriptor({
    pluginId: analyticsPluginManifest.pluginId,
    manifest: analyticsPluginManifest,
    surfaceExports: {
      backend: "@vivd/plugin-analytics/backend/plugin",
      frontend: "@vivd/plugin-analytics/frontend/plugin",
      cli: "@vivd/plugin-analytics/cli/plugin",
    },
  } as const satisfies PluginPackageInstallDescriptor<"analytics">);
