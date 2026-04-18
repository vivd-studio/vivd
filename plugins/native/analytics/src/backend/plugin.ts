import type {
  BackendHostContext,
  NativePluginBackendPackage,
} from "@vivd/plugin-sdk";
import { analyticsPluginManifest } from "../manifest";
import type {
  AnalyticsPluginBackendContribution,
} from "./contribution";
import { createAnalyticsPluginBackendContribution } from "./contribution";
import { analyticsPluginDefinition } from "./module";
import type { AnalyticsPluginBackendContributionDeps } from "./ports";

function createAnalyticsHostContribution(
  hostContext: BackendHostContext,
): AnalyticsPluginBackendContribution {
  return createAnalyticsPluginBackendContribution({
    db: hostContext.db,
    tables: {
      analyticsEvent: hostContext.tables.analyticsEvent,
      contactFormSubmission: hostContext.tables.contactFormSubmission,
      projectPluginInstance: hostContext.tables.projectPluginInstance,
    },
    pluginEntitlementService: hostContext.pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(options) {
        return hostContext.projectPluginInstanceService.ensurePluginInstance({
          ...options,
          defaultConfig: analyticsPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(options) {
        return hostContext.projectPluginInstanceService.getPluginInstance(options);
      },
    },
    getPublicPluginApiBaseUrl: hostContext.runtime.getPublicPluginApiBaseUrl,
    inferSourceHosts: hostContext.runtime.inferProjectPluginSourceHosts,
    hostUtils: hostContext.runtime.hostUtils,
  });
}

export const analyticsBackendPluginPackage = {
  ...analyticsPluginManifest,
  backend: {
    createContribution: createAnalyticsPluginBackendContribution,
    createHostContribution: createAnalyticsHostContribution,
  },
} as const satisfies NativePluginBackendPackage<
  "analytics",
  AnalyticsPluginBackendContributionDeps,
  AnalyticsPluginBackendContribution,
  unknown,
  BackendHostContext
>;

export default analyticsBackendPluginPackage;
