import type { NativePluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { newsletterPluginDefinition } from "./backend/module";
import { newsletterSharedProjectUi } from "./shared/projectUi";

export const newsletterPluginManifest = definePluginPackageManifest({
  manifestVersion: 2,
  pluginId: newsletterPluginDefinition.pluginId,
  kind: newsletterPluginDefinition.kind,
  definition: newsletterPluginDefinition,
  sharedProjectUi: newsletterSharedProjectUi,
  controlPlane: {
    projectPanel: "custom",
    usageLabel: "Signups",
    limitPrompt: "Set monthly signup limit.\nLeave empty for unlimited.",
    supportsMonthlyLimit: true,
    supportsHardStop: true,
    supportsTurnstile: false,
    dashboardPath: null,
  },
  setup: {
    summary:
      "Enable the plugin, choose newsletter or waitlist mode, and install the generated signup snippet.",
    automatedSetup: "partial",
  },
  previewSupport: {
    mode: "native",
  },
} as const satisfies NativePluginPackageManifest<"newsletter">);
