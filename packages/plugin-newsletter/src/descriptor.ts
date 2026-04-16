import type { PluginPackageInstallDescriptor } from "@vivd/plugin-sdk";
import { definePluginPackageInstallDescriptor } from "@vivd/plugin-sdk";
import { newsletterPluginManifest } from "./manifest";

export const newsletterPluginDescriptor =
  definePluginPackageInstallDescriptor({
    pluginId: newsletterPluginManifest.pluginId,
    manifest: newsletterPluginManifest,
    surfaceExports: {
      backend: "@vivd/plugin-newsletter/backend/plugin",
      frontend: "@vivd/plugin-newsletter/frontend/plugin",
      cli: "@vivd/plugin-newsletter/cli/plugin",
    },
  } as const satisfies PluginPackageInstallDescriptor<"newsletter">);
