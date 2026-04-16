import { tableBookingPluginManifest } from "../manifest";
import { createTableBookingPluginBackendContribution } from "./contribution";

export const tableBookingBackendPluginPackage = {
  ...tableBookingPluginManifest,
  backend: {
    createContribution: createTableBookingPluginBackendContribution,
  },
} as const;

export default tableBookingBackendPluginPackage;
