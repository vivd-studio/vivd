import {
  buildSharedProjectPluginUiRegistry,
  definePluginPackageDescriptors,
} from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";

export const studioPluginDescriptors = definePluginPackageDescriptors([
  contactFormPluginDescriptor,
  analyticsPluginDescriptor,
] as const satisfies readonly PluginPackageDescriptor[]);

export const studioSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(studioPluginDescriptors);
