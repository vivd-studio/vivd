import type { PluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { analyticsPluginDefinition } from "./backend/module";
import { analyticsSharedProjectUi } from "./shared/projectUi";

export const analyticsPluginManifest = definePluginPackageManifest({
  manifestVersion: 1,
  pluginId: analyticsPluginDefinition.pluginId,
  definition: analyticsPluginDefinition,
  sharedProjectUi: analyticsSharedProjectUi,
} as const satisfies PluginPackageManifest<"analytics">);
