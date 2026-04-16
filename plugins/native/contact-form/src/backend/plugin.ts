import type { NativePluginBackendPackage } from "@vivd/plugin-sdk";
import { contactFormPluginManifest } from "../manifest";
import type {
  ContactFormPluginBackendContribution,
} from "./contribution";
import { createContactFormPluginBackendContribution } from "./contribution";
import type { ContactFormPluginBackendContributionDeps } from "./ports";

export const contactFormBackendPluginPackage = {
  ...contactFormPluginManifest,
  backend: {
    createContribution: createContactFormPluginBackendContribution,
  },
} as const satisfies NativePluginBackendPackage<
  "contact_form",
  ContactFormPluginBackendContributionDeps,
  ContactFormPluginBackendContribution
>;

export default contactFormBackendPluginPackage;
