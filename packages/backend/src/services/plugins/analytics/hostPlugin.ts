import { createAnalyticsPluginBackendHooks } from "@vivd/plugin-analytics/backend/integrationHooks";
import { analyticsPluginDefinition } from "@vivd/plugin-analytics/backend/module";
import {
  analyticsBackendPluginPackage,
} from "@vivd/plugin-analytics/backend/plugin";
import type { AnalyticsPluginEntitlementServicePort } from "@vivd/plugin-analytics/backend/ports";
import { db } from "../../../db";
import {
  analyticsEvent,
  contactFormSubmission,
  projectPluginInstance,
} from "../../../db/schema";
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

export const analyticsBackendPluginHooks =
  createAnalyticsPluginBackendHooks({
    db,
    tables: {
      analyticsEvent,
    },
  });

export function createAnalyticsBackendHostPluginContribution(options: {
  pluginEntitlementService: AnalyticsPluginEntitlementServicePort;
}) {
  const contribution = analyticsBackendPluginPackage.backend.createContribution({
    db,
    tables: {
      analyticsEvent,
      contactFormSubmission,
      projectPluginInstance,
    },
    pluginEntitlementService: options.pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(hostOptions) {
        return ensureProjectPluginInstance({
          ...hostOptions,
          defaultConfig: analyticsPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(hostOptions) {
        return getProjectPluginInstance(hostOptions);
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

  return {
    ...contribution,
    hooks: analyticsBackendPluginHooks,
  };
}

export const analyticsBackendHostPlugin = {
  pluginId: analyticsBackendPluginPackage.pluginId,
  hooks: analyticsBackendPluginHooks,
  createContribution: createAnalyticsBackendHostPluginContribution,
} as const;
