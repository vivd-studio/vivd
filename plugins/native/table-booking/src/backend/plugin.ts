import type {
  BackendHostContext,
  NativePluginBackendPackage,
} from "@vivd/plugin-sdk";
import { tableBookingPluginManifest } from "../manifest";
import type {
  TableBookingPluginBackendContribution,
  TableBookingPluginBackendContributionDeps,
} from "./contribution";
import { createTableBookingPluginBackendContribution } from "./contribution";
import { tableBookingPluginDefinition } from "./module";

function createTableBookingHostContribution(
  hostContext: BackendHostContext,
): TableBookingPluginBackendContribution {
  return createTableBookingPluginBackendContribution({
    db: hostContext.db,
    tables: {
      tableBookingReservation: hostContext.tables.tableBookingReservation,
      tableBookingActionToken: hostContext.tables.tableBookingActionToken,
      tableBookingCapacityAdjustment: hostContext.tables.tableBookingCapacityAdjustment,
      projectMeta: hostContext.tables.projectMeta,
      projectPluginInstance: hostContext.tables.projectPluginInstance,
    },
    pluginEntitlementService: hostContext.pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(options) {
        return hostContext.projectPluginInstanceService.ensurePluginInstance({
          ...options,
          defaultConfig: tableBookingPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(options) {
        return hostContext.projectPluginInstanceService.getPluginInstance(options);
      },
      updatePluginInstance(options) {
        return hostContext.projectPluginInstanceService.updatePluginInstance(options);
      },
    },
    getPublicPluginApiBaseUrl: hostContext.runtime.getPublicPluginApiBaseUrl,
    inferSourceHosts: hostContext.runtime.inferProjectPluginSourceHosts,
    hostUtils: hostContext.runtime.hostUtils,
    emailDeliveryService: hostContext.email.deliveryService,
    emailTemplates: {
      buildGuestConfirmationEmail(options) {
        return hostContext.email.templates.buildGuestBookingConfirmationEmail!(options);
      },
      buildGuestCancellationEmail(options) {
        return hostContext.email.templates.buildGuestBookingCancellationEmail!(options);
      },
      buildStaffNewBookingEmail(options) {
        return hostContext.email.templates.buildStaffNewBookingEmail!(options);
      },
      buildStaffCancellationEmail(options) {
        return hostContext.email.templates.buildStaffBookingCancellationEmail!(options);
      },
    },
  });
}

export const tableBookingBackendPluginPackage = {
  ...tableBookingPluginManifest,
  backend: {
    createContribution: createTableBookingPluginBackendContribution,
    createHostContribution: createTableBookingHostContribution,
  },
} as const satisfies NativePluginBackendPackage<
  "table_booking",
  TableBookingPluginBackendContributionDeps,
  TableBookingPluginBackendContribution,
  unknown,
  BackendHostContext
>;

export default tableBookingBackendPluginPackage;
