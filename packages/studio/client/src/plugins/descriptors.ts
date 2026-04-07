import type {
  PluginPackageDescriptor,
  ProjectPluginUiRegistry,
} from "@vivd/shared/types";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";

export const studioPluginDescriptors = [
  analyticsPluginDescriptor,
] satisfies readonly PluginPackageDescriptor[];

export const studioSharedProjectPluginUiRegistry = Object.fromEntries(
  studioPluginDescriptors.flatMap((descriptor) =>
    descriptor.sharedProjectUi
      ? [[descriptor.pluginId, descriptor.sharedProjectUi] as const]
      : [],
  ),
) satisfies ProjectPluginUiRegistry;
