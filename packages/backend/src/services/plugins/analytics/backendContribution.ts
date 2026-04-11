import { createAnalyticsPluginBackendContribution } from "@vivd/plugin-analytics/backend/contribution";
import { analyticsPluginDefinition } from "@vivd/plugin-analytics/backend/module";
import { db } from "../../../db";
import {
  analyticsEvent,
  contactFormSubmission,
  projectPluginInstance,
} from "../../../db/schema";
import { pluginEntitlementService } from "../PluginEntitlementService";
import {
  ensureProjectPluginInstance,
  getProjectPluginInstance,
} from "../core/instanceStore";
import { getPublicPluginApiBaseUrl } from "../runtime/publicApi";
import { inferProjectPluginSourceHosts } from "../runtime/sourceHosts";
import {
  extractSourceHostFromHeaders,
  isHostAllowed,
  normalizeHostCandidate,
} from "../runtime/hostUtils";

export const analyticsPluginBackendContribution =
  createAnalyticsPluginBackendContribution({
    db,
    tables: {
      analyticsEvent,
      contactFormSubmission,
      projectPluginInstance,
    },
    pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(options) {
        return ensureProjectPluginInstance({
          ...options,
          defaultConfig: analyticsPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(options) {
        return getProjectPluginInstance(options);
      },
    },
    getPublicPluginApiBaseUrl,
    inferSourceHosts: inferProjectPluginSourceHosts,
    hostUtils: {
      extractSourceHostFromHeaders,
      isHostAllowed,
      normalizeHostCandidate,
    },
  });

export const analyticsPluginService = analyticsPluginBackendContribution.service;
export const analyticsPluginModule = analyticsPluginBackendContribution.module;
export const analyticsPluginPublicRoutes =
  analyticsPluginBackendContribution.publicRoutes;
