import type { PluginPackageInstallDescriptor } from "@vivd/plugin-sdk";
import { definePluginPackageInstallDescriptor } from "@vivd/plugin-sdk";
import { tableBookingPluginManifest } from "./manifest";

export const tableBookingPluginDescriptor =
  definePluginPackageInstallDescriptor({
    pluginId: tableBookingPluginManifest.pluginId,
    manifest: tableBookingPluginManifest,
    surfaceExports: {
      backend: "@vivd/plugin-table-booking/backend/plugin",
      frontend: "@vivd/plugin-table-booking/frontend/plugin",
      cli: "@vivd/plugin-table-booking/cli/plugin",
    },
  } as const satisfies PluginPackageInstallDescriptor<"table_booking">);
