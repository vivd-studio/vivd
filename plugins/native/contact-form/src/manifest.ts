import type { PluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { contactFormPluginDefinition } from "./backend/module";
import { contactFormSharedProjectUi } from "./shared/projectUi";

export const contactFormPluginManifest = definePluginPackageManifest({
  manifestVersion: 2,
  pluginId: contactFormPluginDefinition.pluginId,
  kind: contactFormPluginDefinition.kind,
  definition: contactFormPluginDefinition,
  sharedProjectUi: contactFormSharedProjectUi,
  setup: {
    summary:
      "Enable the plugin, configure recipient emails, and install the generated contact form snippet.",
    automatedSetup: "partial",
  },
  previewSupport: {
    mode: "native",
  },
} as const satisfies PluginPackageManifest<"contact_form">);
