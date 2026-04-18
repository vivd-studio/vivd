export {
  newsletterPluginConfigSchema,
  newsletterPluginModeSchema,
} from "./backend/config";
export type {
  NewsletterPluginConfig,
  NewsletterPluginMode,
} from "./backend/config";
export {
  createNewsletterPluginModule,
  newsletterPluginDefinition,
} from "./backend/module";
export type {
  NewsletterPluginInfoSource,
  NewsletterPluginBackendRuntime,
} from "./backend/module";
export {
  createNewsletterPluginBackendContribution,
} from "./backend/contribution";
export { newsletterBackendPluginPackage } from "./backend/plugin";
export type {
  NewsletterPluginBackendContributionDeps,
} from "./backend/contribution";
export { createNewsletterPluginBackendHooks } from "./backend/integrationHooks";
export { newsletterCliModule } from "./cli/module";
export { newsletterCliPluginPackage } from "./cli/plugin";
export { newsletterFrontendPluginModule } from "./frontend/module";
export { newsletterFrontendPluginPackage } from "./frontend/plugin";
export { default as NewsletterProjectPage } from "./frontend/NewsletterProjectPage";
export { newsletterPluginManifest } from "./manifest";
export { newsletterSharedProjectUi } from "./shared/projectUi";
export {
  NEWSLETTER_CAMPAIGNS_READ_ID,
  NEWSLETTER_SUBSCRIBERS_READ_ID,
  NEWSLETTER_SUMMARY_READ_ID,
  newsletterCampaignsReadDefinition,
  newsletterSubscribersReadDefinition,
  newsletterSummaryReadDefinition,
} from "./shared/summary";
