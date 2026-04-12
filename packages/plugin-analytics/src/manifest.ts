import type { PluginPackageManifest } from "@vivd/shared/types";
import { definePluginPackageManifest } from "@vivd/shared/types";
import { analyticsPluginDefinition } from "./backend/module";
import { analyticsSharedProjectUi } from "./shared/projectUi";

export const analyticsPluginManifest = definePluginPackageManifest({
  manifestVersion: 1,
  pluginId: analyticsPluginDefinition.pluginId,
  definition: analyticsPluginDefinition,
  sharedProjectUi: analyticsSharedProjectUi,
} as const satisfies PluginPackageManifest<"analytics">);
