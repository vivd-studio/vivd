import {
  buildSharedProjectPluginUiRegistry,
  definePluginPackageDescriptors,
} from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsPluginManifest } from "@vivd/plugin-analytics/manifest";
import { contactFormPluginManifest } from "@vivd/plugin-contact-form/manifest";

export const studioPluginDescriptors = definePluginPackageDescriptors([
  contactFormPluginManifest,
  analyticsPluginManifest,
] as const satisfies readonly PluginPackageDescriptor[]);

export const studioSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(studioPluginDescriptors);
