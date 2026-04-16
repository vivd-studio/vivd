import { tableBookingPluginManifest } from "../manifest";
import { tableBookingFrontendPluginModule } from "./module";

export const tableBookingFrontendPluginPackage = {
  ...tableBookingPluginManifest,
  frontend: tableBookingFrontendPluginModule,
} as const;
