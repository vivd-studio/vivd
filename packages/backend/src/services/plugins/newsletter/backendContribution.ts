import { pluginEntitlementService } from "../PluginEntitlementService";
import { createNewsletterBackendHostPluginContribution } from "./hostPlugin";

type NewsletterBackendContribution = ReturnType<
  typeof createNewsletterBackendHostPluginContribution
>;

let cachedNewsletterPluginBackendContribution:
  | NewsletterBackendContribution
  | null = null;

function createNewsletterBackendContribution(): NewsletterBackendContribution {
  return createNewsletterBackendHostPluginContribution({
    pluginEntitlementService,
  });
}

export function getNewsletterPluginBackendContribution(): NewsletterBackendContribution {
  if (!cachedNewsletterPluginBackendContribution) {
    cachedNewsletterPluginBackendContribution =
      createNewsletterBackendContribution();
  }

  return cachedNewsletterPluginBackendContribution;
}

export const newsletterPluginBackendContribution = {} as NewsletterBackendContribution;

Object.defineProperties(newsletterPluginBackendContribution, {
  service: {
    enumerable: true,
    get() {
      return getNewsletterPluginBackendContribution().service;
    },
  },
  module: {
    enumerable: true,
    get() {
      return getNewsletterPluginBackendContribution().module;
    },
  },
  hooks: {
    enumerable: true,
    get() {
      return getNewsletterPluginBackendContribution().hooks;
    },
  },
  publicRoutes: {
    enumerable: true,
    get() {
      return getNewsletterPluginBackendContribution().publicRoutes;
    },
  },
});
