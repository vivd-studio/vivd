import { newsletterPluginManifest } from "../manifest";
import { createNewsletterPluginBackendContribution } from "./contribution";

export const newsletterBackendPluginPackage = {
  ...newsletterPluginManifest,
  backend: {
    createContribution: createNewsletterPluginBackendContribution,
  },
} as const;
