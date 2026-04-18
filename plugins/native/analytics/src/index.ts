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
export { analyticsBackendPluginPackage } from "./backend/plugin";
export { analyticsCliModule } from "./cli/module";
export { analyticsCliPluginPackage } from "./cli/plugin";
export { analyticsFrontendPluginModule } from "./frontend/module";
export { analyticsFrontendPluginPackage } from "./frontend/plugin";
export { default as AnalyticsProjectPage } from "./frontend/AnalyticsProjectPage";
export { analyticsPluginManifest } from "./manifest";
export { analyticsSharedProjectUi } from "./shared/projectUi";
export {
  ANALYTICS_SUMMARY_READ_ID,
  analyticsSummaryReadDefinition,
} from "./shared/summary";
