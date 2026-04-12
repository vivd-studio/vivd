import type { PluginPackageManifest } from "@vivd/shared/types";
import { definePluginPackageManifest } from "@vivd/shared/types";
import { contactFormPluginDefinition } from "./backend/module";
import { contactFormSharedProjectUi } from "./shared/projectUi";

export const contactFormPluginManifest = definePluginPackageManifest({
  manifestVersion: 1,
  pluginId: contactFormPluginDefinition.pluginId,
  definition: contactFormPluginDefinition,
  sharedProjectUi: contactFormSharedProjectUi,
} as const satisfies PluginPackageManifest<"contact_form">);
