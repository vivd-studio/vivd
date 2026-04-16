import type { NativePluginBackendPackage } from "@vivd/plugin-sdk";
import { tableBookingPluginManifest } from "../manifest";
import type {
  TableBookingPluginBackendContribution,
  TableBookingPluginBackendContributionDeps,
} from "./contribution";
import { createTableBookingPluginBackendContribution } from "./contribution";

export const tableBookingBackendPluginPackage = {
  ...tableBookingPluginManifest,
  backend: {
    createContribution: createTableBookingPluginBackendContribution,
  },
} as const satisfies NativePluginBackendPackage<
  "table_booking",
  TableBookingPluginBackendContributionDeps,
  TableBookingPluginBackendContribution
>;

export default tableBookingBackendPluginPackage;
