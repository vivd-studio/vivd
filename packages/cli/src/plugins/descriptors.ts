import { definePluginPackageDescriptors } from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsCliPluginPackage } from "@vivd/plugin-analytics/cli/plugin";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";

export const cliPluginDescriptors = definePluginPackageDescriptors([
  contactFormPluginDescriptor,
  analyticsCliPluginPackage,
] as const satisfies readonly PluginPackageDescriptor[]);
