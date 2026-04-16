import type { PluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { newsletterPluginDefinition } from "./backend/module";
import { newsletterSharedProjectUi } from "./shared/projectUi";

export const newsletterPluginManifest = definePluginPackageManifest({
  manifestVersion: 2,
  pluginId: newsletterPluginDefinition.pluginId,
  kind: newsletterPluginDefinition.kind,
  definition: newsletterPluginDefinition,
  sharedProjectUi: newsletterSharedProjectUi,
  setup: {
    summary:
      "Enable the plugin, choose newsletter or waitlist mode, and install the generated signup snippet.",
    automatedSetup: "partial",
  },
  previewSupport: {
    mode: "native",
  },
} as const satisfies PluginPackageManifest<"newsletter">);
