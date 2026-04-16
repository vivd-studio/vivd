import type { NativePluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { tableBookingPluginDefinition } from "./backend/module";
import { tableBookingSharedProjectUi } from "./shared/projectUi";

export const tableBookingPluginManifest = definePluginPackageManifest({
  manifestVersion: 2,
  pluginId: tableBookingPluginDefinition.pluginId,
  kind: tableBookingPluginDefinition.kind,
  definition: tableBookingPluginDefinition,
  sharedProjectUi: tableBookingSharedProjectUi,
  controlPlane: {
    projectPanel: "custom",
    usageLabel: "Bookings",
    limitPrompt: "Set monthly booking limit.\nLeave empty for unlimited.",
    supportsMonthlyLimit: true,
    supportsHardStop: true,
    supportsTurnstile: false,
    dashboardPath: null,
  },
  setup: {
    summary:
      "Enable the plugin, configure schedule and notification recipients, and install the booking widget snippet.",
    automatedSetup: "partial",
  },
  previewSupport: {
    mode: "native",
  },
} as const satisfies NativePluginPackageManifest<"table_booking">);
