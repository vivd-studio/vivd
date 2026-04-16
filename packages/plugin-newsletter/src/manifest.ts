import type { PluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { newsletterPluginDefinition } from "./backend/module";
import { newsletterSharedProjectUi } from "./shared/projectUi";

export const newsletterPluginManifest = definePluginPackageManifest({
  manifestVersion: 1,
  pluginId: newsletterPluginDefinition.pluginId,
  definition: newsletterPluginDefinition,
  sharedProjectUi: newsletterSharedProjectUi,
} as const satisfies PluginPackageManifest<"newsletter">);
