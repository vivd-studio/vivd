import type {
  BackendHostContext,
  NativePluginBackendPackage,
} from "@vivd/plugin-sdk";
import { newsletterPluginManifest } from "../manifest";
import type {
  NewsletterPluginBackendContribution,
  NewsletterPluginBackendContributionDeps,
} from "./contribution";
import { createNewsletterPluginBackendContribution } from "./contribution";
import {
  buildNewsletterCampaignEmail,
  buildNewsletterConfirmationEmail,
} from "./emails";
import { newsletterPluginDefinition } from "./module";

function createNewsletterHostContribution(
  hostContext: BackendHostContext,
): NewsletterPluginBackendContribution {
  return createNewsletterPluginBackendContribution({
    db: hostContext.db,
    tables: {
      newsletterSubscriber: hostContext.tables.newsletterSubscriber,
      newsletterActionToken: hostContext.tables.newsletterActionToken,
      newsletterCampaign: hostContext.tables.newsletterCampaign,
      newsletterCampaignDelivery: hostContext.tables.newsletterCampaignDelivery,
      projectMeta: hostContext.tables.projectMeta,
      projectPluginInstance: hostContext.tables.projectPluginInstance,
    },
    pluginEntitlementService: hostContext.pluginEntitlementService,
    projectPluginInstanceService: {
      ensurePluginInstance(options) {
        return hostContext.projectPluginInstanceService.ensurePluginInstance({
          ...options,
          defaultConfig: newsletterPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(options) {
        return hostContext.projectPluginInstanceService.getPluginInstance(
          options,
        );
      },
      updatePluginInstance(options) {
        return hostContext.projectPluginInstanceService.updatePluginInstance(
          options,
        );
      },
    },
    getPublicPluginApiBaseUrl: hostContext.runtime.getPublicPluginApiBaseUrl,
    inferSourceHosts: hostContext.runtime.inferProjectPluginSourceHosts,
    hostUtils: hostContext.runtime.hostUtils,
    emailDeliveryService: hostContext.email.deliveryService,
    emailTemplates: {
      buildConfirmationEmail(options) {
        return buildNewsletterConfirmationEmail(
          options,
          hostContext.email.brandingResolver,
        );
      },
      buildCampaignEmail(options) {
        return buildNewsletterCampaignEmail(
          options,
          hostContext.email.brandingResolver,
        );
      },
    },
  });
}

export const newsletterBackendPluginPackage = {
  ...newsletterPluginManifest,
  backend: {
    createContribution: createNewsletterPluginBackendContribution,
    createHostContribution: createNewsletterHostContribution,
  },
} as const satisfies NativePluginBackendPackage<
  "newsletter",
  NewsletterPluginBackendContributionDeps,
  NewsletterPluginBackendContribution,
  unknown,
  BackendHostContext
>;

export default newsletterBackendPluginPackage;
