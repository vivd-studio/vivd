import {
  analyticsPluginConfigSchema,
  analyticsPluginDefinition,
  type AnalyticsPluginConfig,
} from "@vivd/plugin-analytics/backend/module";
import { analyticsPluginModule } from "./backendContribution";

export { analyticsPluginConfigSchema, analyticsPluginDefinition };
export type { AnalyticsPluginConfig };
export { analyticsPluginModule };
