import { definePluginPackageDescriptors } from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsCliPluginPackage } from "@vivd/plugin-analytics/cli/plugin";
import { contactFormCliPluginPackage } from "@vivd/plugin-contact-form/cli/plugin";

export const cliPluginDescriptors = definePluginPackageDescriptors([
  contactFormCliPluginPackage,
  analyticsCliPluginPackage,
] as const satisfies readonly PluginPackageDescriptor[]);
