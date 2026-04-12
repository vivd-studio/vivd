import {
  buildSharedProjectPluginUiRegistry,
  definePluginPackageDescriptors,
} from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsPluginManifest } from "@vivd/plugin-analytics/manifest";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";

export const studioPluginDescriptors = definePluginPackageDescriptors([
  contactFormPluginDescriptor,
  analyticsPluginManifest,
] as const satisfies readonly PluginPackageDescriptor[]);

export const studioSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(studioPluginDescriptors);
