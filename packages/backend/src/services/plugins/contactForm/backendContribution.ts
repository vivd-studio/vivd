import { pluginEntitlementService } from "../PluginEntitlementService";
import { createContactFormBackendHostPluginContribution } from "./hostPlugin";

export const contactFormPluginBackendContribution =
  createContactFormBackendHostPluginContribution({
    pluginEntitlementService,
  });

export const contactFormPluginService = contactFormPluginBackendContribution.service;
export const contactFormPluginModule = contactFormPluginBackendContribution.module;
export const contactFormPluginPublicRoutes =
  contactFormPluginBackendContribution.publicRoutes;
