export {
  createAnalyticsPluginBackendContribution,
} from "./backend/contribution";
export {
  analyticsPluginConfigSchema,
  analyticsPluginDefinition,
  createAnalyticsPluginModule,
} from "./backend/module";
export type {
  AnalyticsPluginBackendContributionDeps,
} from "./backend/ports";
export { analyticsPluginDescriptor } from "./descriptor";
export { analyticsCliModule } from "./cli/module";
export { analyticsFrontendPluginModule } from "./frontend/module";
export { default as AnalyticsProjectPage } from "./frontend/AnalyticsProjectPage";
export { analyticsSharedProjectUi } from "./shared/projectUi";
export {
  ANALYTICS_SUMMARY_READ_ID,
  analyticsSummaryReadDefinition,
} from "./shared/summary";
