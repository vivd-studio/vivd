import type { PluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { analyticsPluginDefinition } from "./backend/module";
import { analyticsSharedProjectUi } from "./shared/projectUi";

export const analyticsPluginManifest = definePluginPackageManifest({
  manifestVersion: 2,
  pluginId: analyticsPluginDefinition.pluginId,
  kind: analyticsPluginDefinition.kind,
  definition: analyticsPluginDefinition,
  sharedProjectUi: analyticsSharedProjectUi,
  setup: {
    summary:
      "Enable the plugin, review tracking settings, and install the generated analytics snippet.",
    automatedSetup: "partial",
  },
  previewSupport: {
    mode: "native",
  },
} as const satisfies PluginPackageManifest<"analytics">);
