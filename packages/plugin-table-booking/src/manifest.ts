import type { PluginPackageManifest } from "@vivd/plugin-sdk";
import { definePluginPackageManifest } from "@vivd/plugin-sdk";
import { tableBookingPluginDefinition } from "./backend/module";
import { tableBookingSharedProjectUi } from "./shared/projectUi";

export const tableBookingPluginManifest = definePluginPackageManifest({
  manifestVersion: 1,
  pluginId: tableBookingPluginDefinition.pluginId,
  definition: tableBookingPluginDefinition,
  sharedProjectUi: tableBookingSharedProjectUi,
} as const satisfies PluginPackageManifest<"table_booking">);
