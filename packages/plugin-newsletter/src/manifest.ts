import type { PluginPackageManifest } from "@vivd/shared/types";
import { definePluginPackageManifest } from "@vivd/shared/types";
import { newsletterPluginDefinition } from "./backend/module";
import { newsletterSharedProjectUi } from "./shared/projectUi";

export const newsletterPluginManifest = definePluginPackageManifest({
  manifestVersion: 1,
  pluginId: newsletterPluginDefinition.pluginId,
  definition: newsletterPluginDefinition,
  sharedProjectUi: newsletterSharedProjectUi,
} as const satisfies PluginPackageManifest<"newsletter">);
