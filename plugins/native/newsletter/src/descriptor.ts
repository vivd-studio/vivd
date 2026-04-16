import type { PluginBundleEntry } from "@vivd/plugin-sdk";
import { definePluginBundleEntry } from "@vivd/plugin-sdk";
import { newsletterPluginManifest } from "./manifest";

export const newsletterPluginDescriptor =
  definePluginBundleEntry({
    pluginId: newsletterPluginManifest.pluginId,
    manifest: newsletterPluginManifest,
    surfaceExports: {
      backend: "@vivd/plugin-newsletter/backend/plugin",
      frontend: "@vivd/plugin-newsletter/frontend/plugin",
      cli: "@vivd/plugin-newsletter/cli/plugin",
    },
  } as const satisfies PluginBundleEntry<"newsletter">);

export default newsletterPluginDescriptor;
