import {
  createAnalyticsPluginModule,
  analyticsPluginConfigSchema,
  analyticsPluginDefinition,
  type AnalyticsPluginConfig,
} from "@vivd/plugin-analytics/backend/module";
import type { PluginModule } from "@vivd/shared/types";
import {
  AnalyticsPluginNotEnabledError,
  analyticsPluginService,
} from "./service";

export { analyticsPluginConfigSchema, analyticsPluginDefinition };
export type { AnalyticsPluginConfig };

export const analyticsPluginModule: PluginModule<"analytics"> =
  createAnalyticsPluginModule({
  async ensurePlugin(options) {
    const result = await analyticsPluginService.ensureAnalyticsPlugin(options);
    return {
      instanceId: result.instanceId,
      created: result.created,
      status: result.status,
    };
  },
  getInfo(options) {
    return analyticsPluginService.getAnalyticsInfo(options);
  },
  async updateConfig(options) {
    await analyticsPluginService.updateAnalyticsConfig(options);
    return analyticsPluginService.getAnalyticsInfo(options);
  },
  isNotEnabledError(error) {
    return error instanceof AnalyticsPluginNotEnabledError;
  },
  });
