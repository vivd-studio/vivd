import { contactFormPluginManifest } from "../manifest";
import { createContactFormPluginBackendContribution } from "./contribution";

export const contactFormBackendPluginPackage = {
  ...contactFormPluginManifest,
  backend: {
    createContribution: createContactFormPluginBackendContribution,
  },
} as const;

export default contactFormBackendPluginPackage;
