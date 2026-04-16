import { getEmailDeliveryService } from "../../integrations/EmailDeliveryService";
import { pluginEntitlementService } from "../PluginEntitlementService";
import { createTableBookingBackendHostPluginContribution } from "./hostPlugin";

type TableBookingBackendContribution = ReturnType<
  typeof createTableBookingBackendHostPluginContribution
>;

let cachedTableBookingPluginBackendContribution:
  | TableBookingBackendContribution
  | null = null;

function createTableBookingBackendContribution(): TableBookingBackendContribution {
  return createTableBookingBackendHostPluginContribution({
    pluginEntitlementService,
  });
}

export function getTableBookingPluginBackendContribution(): TableBookingBackendContribution {
  if (!cachedTableBookingPluginBackendContribution) {
    cachedTableBookingPluginBackendContribution =
      createTableBookingBackendContribution();
  }

  return cachedTableBookingPluginBackendContribution;
}

export const tableBookingPluginBackendContribution =
  {} as TableBookingBackendContribution;

Object.defineProperties(tableBookingPluginBackendContribution, {
  service: {
    enumerable: true,
    get() {
      return getTableBookingPluginBackendContribution().service;
    },
  },
  module: {
    enumerable: true,
    get() {
      return getTableBookingPluginBackendContribution().module;
    },
  },
  hooks: {
    enumerable: true,
    get() {
      return getTableBookingPluginBackendContribution().hooks;
    },
  },
  publicRoutes: {
    enumerable: true,
    get() {
      return getTableBookingPluginBackendContribution().publicRoutes;
    },
  },
});
