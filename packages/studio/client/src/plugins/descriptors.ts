import {
  buildSharedProjectPluginUiRegistry,
  definePluginPackageDescriptors,
} from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsPluginManifest } from "@vivd/plugin-analytics/manifest";
import { contactFormPluginManifest } from "@vivd/plugin-contact-form/manifest";
import { newsletterPluginManifest } from "@vivd/plugin-newsletter/manifest";

export const studioPluginDescriptors = definePluginPackageDescriptors([
  contactFormPluginManifest,
  analyticsPluginManifest,
  newsletterPluginManifest,
] as const satisfies readonly PluginPackageDescriptor[]);

export const studioSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(studioPluginDescriptors);
