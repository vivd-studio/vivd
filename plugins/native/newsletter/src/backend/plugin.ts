import type { NativePluginBackendPackage } from "@vivd/plugin-sdk";
import { newsletterPluginManifest } from "../manifest";
import type {
  NewsletterPluginBackendContribution,
  NewsletterPluginBackendContributionDeps,
} from "./contribution";
import { createNewsletterPluginBackendContribution } from "./contribution";

export const newsletterBackendPluginPackage = {
  ...newsletterPluginManifest,
  backend: {
    createContribution: createNewsletterPluginBackendContribution,
  },
} as const satisfies NativePluginBackendPackage<
  "newsletter",
  NewsletterPluginBackendContributionDeps,
  NewsletterPluginBackendContribution
>;

export default newsletterBackendPluginPackage;
