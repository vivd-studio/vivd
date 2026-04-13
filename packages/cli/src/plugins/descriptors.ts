import { definePluginPackageDescriptors } from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsCliPluginPackage } from "@vivd/plugin-analytics/cli/plugin";
import { contactFormCliPluginPackage } from "@vivd/plugin-contact-form/cli/plugin";
import { newsletterCliPluginPackage } from "@vivd/plugin-newsletter/cli/plugin";

export const cliPluginDescriptors = definePluginPackageDescriptors([
  contactFormCliPluginPackage,
  analyticsCliPluginPackage,
  newsletterCliPluginPackage,
] as const satisfies readonly PluginPackageDescriptor[]);
