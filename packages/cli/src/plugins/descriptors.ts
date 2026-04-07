import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";

export const cliPluginDescriptors = [
  contactFormPluginDescriptor,
  analyticsPluginDescriptor,
] satisfies readonly PluginPackageDescriptor[];
