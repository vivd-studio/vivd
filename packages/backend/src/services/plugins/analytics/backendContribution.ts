import { createAnalyticsPluginBackendContribution } from "@vivd/plugin-analytics/backend/contribution";
import { db } from "../../../db";
import {
  analyticsEvent,
  contactFormSubmission,
  projectPluginInstance,
} from "../../../db/schema";
import { pluginEntitlementService } from "../PluginEntitlementService";
import { projectPluginInstanceService } from "../core/instanceService";
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
    projectPluginInstanceService,
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
