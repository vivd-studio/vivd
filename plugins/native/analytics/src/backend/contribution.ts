import type express from "express";
import type { Multer } from "multer";
import type {
  PluginContribution,
  PluginRouteDefinition,
} from "@vivd/plugin-sdk";
import { createAnalyticsPublicRouter } from "./http/runtime";
import { createAnalyticsPluginBackendHooks } from "./integrationHooks";
import { createAnalyticsPluginModule } from "./module";
import {
  AnalyticsPluginNotEnabledError,
  createAnalyticsPluginService,
  type AnalyticsPluginService,
} from "./service";
import type { AnalyticsPluginBackendContributionDeps } from "./ports";

export interface AnalyticsBackendRouteDeps {
  upload: Pick<Multer, "none">;
}

export interface AnalyticsBackendRouteDefinition
  extends PluginRouteDefinition<express.Router, AnalyticsBackendRouteDeps> {}

export interface AnalyticsPluginBackendContribution
  extends PluginContribution<
    "analytics",
    ReturnType<typeof createAnalyticsPluginBackendHooks>,
    AnalyticsBackendRouteDefinition
  > {
  service: AnalyticsPluginService;
}

export function createAnalyticsPluginBackendContribution(
  deps: AnalyticsPluginBackendContributionDeps,
): AnalyticsPluginBackendContribution {
  const service = createAnalyticsPluginService(deps);
  const hooks = createAnalyticsPluginBackendHooks({
    db: deps.db,
    tables: {
      analyticsEvent: deps.tables.analyticsEvent,
    },
  });

  return {
    service,
    module: createAnalyticsPluginModule({
      async ensurePlugin(options) {
        const result = await service.ensureAnalyticsPlugin(options);
        return {
          instanceId: result.instanceId,
          created: result.created,
          status: result.status,
        };
      },
      getInfo(options) {
        return service.getAnalyticsInfo(options);
      },
      async updateConfig(options) {
        await service.updateAnalyticsConfig(options);
        return service.getAnalyticsInfo(options);
      },
      readSummary(options) {
        return service.getAnalyticsSummary(options);
      },
      isNotEnabledError(error) {
        return error instanceof AnalyticsPluginNotEnabledError;
      },
    }),
    hooks,
    publicRoutes: [
      {
        routeId: "analytics.public",
        mountPath: "/plugins",
        createRouter: (routeDeps) =>
          createAnalyticsPublicRouter({
            ...deps,
            upload: routeDeps.upload,
          }),
      },
    ],
  };
}
