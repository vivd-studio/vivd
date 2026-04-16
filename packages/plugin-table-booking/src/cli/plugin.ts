import { tableBookingCliModule } from "./module";
import { tableBookingPluginManifest } from "../manifest";

export const tableBookingCliPluginPackage = {
  ...tableBookingPluginManifest,
  cli: tableBookingCliModule,
} as const;
