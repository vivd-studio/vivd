import type { PluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { contactFormPluginDefinition } from "./backend/module";
import { contactFormSharedProjectUi } from "./shared/projectUi";

export const contactFormPluginManifest = definePluginPackageManifest({
  manifestVersion: 1,
  pluginId: contactFormPluginDefinition.pluginId,
  definition: contactFormPluginDefinition,
  sharedProjectUi: contactFormSharedProjectUi,
} as const satisfies PluginPackageManifest<"contact_form">);
