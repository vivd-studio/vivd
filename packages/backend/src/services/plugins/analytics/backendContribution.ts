import { pluginEntitlementService } from "../PluginEntitlementService";
import { createAnalyticsBackendHostPluginContribution } from "./hostPlugin";

export const analyticsPluginBackendContribution =
  createAnalyticsBackendHostPluginContribution({
    pluginEntitlementService,
  });

export const analyticsPluginService = analyticsPluginBackendContribution.service;
export const analyticsPluginModule = analyticsPluginBackendContribution.module;
export const analyticsPluginPublicRoutes =
  analyticsPluginBackendContribution.publicRoutes;
