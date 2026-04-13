import {
  definePluginPackageDescriptors,
  extractPluginIds,
} from "@vivd/shared/types";
import { analyticsPluginManifest } from "@vivd/plugin-analytics/manifest";
import { contactFormPluginManifest } from "@vivd/plugin-contact-form/manifest";
import { newsletterPluginManifest } from "@vivd/plugin-newsletter/manifest";

export const installedPluginManifests = definePluginPackageDescriptors([
  contactFormPluginManifest,
  analyticsPluginManifest,
  newsletterPluginManifest,
] as const);

export const INSTALLED_PLUGIN_IDS = extractPluginIds(installedPluginManifests);
export type InstalledPluginId = (typeof INSTALLED_PLUGIN_IDS)[number];
