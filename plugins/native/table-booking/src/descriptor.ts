import type { PluginBundleEntry } from "@vivd/plugin-sdk";
import { definePluginBundleEntry } from "@vivd/plugin-sdk";
import { tableBookingPluginManifest } from "./manifest";

export const tableBookingPluginDescriptor =
  definePluginBundleEntry({
    pluginId: tableBookingPluginManifest.pluginId,
    manifest: tableBookingPluginManifest,
    surfaceExports: {
      backend: "@vivd/plugin-table-booking/backend/plugin",
      frontend: "@vivd/plugin-table-booking/frontend/plugin",
      cli: "@vivd/plugin-table-booking/cli/plugin",
    },
  } as const satisfies PluginBundleEntry<"table_booking">);
