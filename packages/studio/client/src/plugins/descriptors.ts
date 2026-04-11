import type {
  PluginPackageDescriptor,
  ProjectPluginUiRegistry,
} from "@vivd/shared/types";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";

export const studioPluginDescriptors = [
  contactFormPluginDescriptor,
  analyticsPluginDescriptor,
] satisfies readonly PluginPackageDescriptor[];

export const studioSharedProjectPluginUiRegistry = Object.fromEntries(
  studioPluginDescriptors.flatMap((descriptor) =>
    descriptor.sharedProjectUi
      ? [[descriptor.pluginId, descriptor.sharedProjectUi] as const]
      : [],
  ),
) satisfies ProjectPluginUiRegistry;
