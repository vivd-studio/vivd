import { definePluginPackageDescriptors } from "@vivd/plugin-sdk";
import type { PluginPackageDescriptor } from "@vivd/plugin-sdk";
import { analyticsBackendPluginPackage } from "@vivd/plugin-analytics/backend/plugin";
import { contactFormBackendPluginPackage } from "@vivd/plugin-contact-form/backend/plugin";
import { newsletterBackendPluginPackage } from "@vivd/plugin-newsletter/backend/plugin";
import {
  installedPluginManifests,
  type InstalledPluginId,
} from "./index";

type BackendPluginPackage = PluginPackageDescriptor<InstalledPluginId, never, unknown>;

const backendPluginPackagesById = {
  contact_form: contactFormBackendPluginPackage,
  analytics: analyticsBackendPluginPackage,
  newsletter: newsletterBackendPluginPackage,
} as const satisfies Record<InstalledPluginId, BackendPluginPackage>;

export const installedBackendPluginPackages = definePluginPackageDescriptors(
  installedPluginManifests.map(
    (manifest) => backendPluginPackagesById[manifest.pluginId],
  ) as readonly BackendPluginPackage[],
);
