import type { PluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { tableBookingPluginDefinition } from "./backend/module";
import { tableBookingSharedProjectUi } from "./shared/projectUi";

export const tableBookingPluginManifest = definePluginPackageManifest({
  manifestVersion: 2,
  pluginId: tableBookingPluginDefinition.pluginId,
  kind: tableBookingPluginDefinition.kind,
  definition: tableBookingPluginDefinition,
  sharedProjectUi: tableBookingSharedProjectUi,
  setup: {
    summary:
      "Enable the plugin, configure schedule and notification recipients, and install the booking widget snippet.",
    automatedSetup: "partial",
  },
  previewSupport: {
    mode: "native",
  },
} as const satisfies PluginPackageManifest<"table_booking">);
