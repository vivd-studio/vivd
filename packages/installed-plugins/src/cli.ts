import { definePluginPackageDescriptors } from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsCliPluginPackage } from "@vivd/plugin-analytics/cli/plugin";
import { contactFormCliPluginPackage } from "@vivd/plugin-contact-form/cli/plugin";
import { newsletterCliPluginPackage } from "@vivd/plugin-newsletter/cli/plugin";
import {
  installedPluginManifests,
  type InstalledPluginId,
} from "./index";

type CliPluginPackage = PluginPackageDescriptor<InstalledPluginId, unknown>;

const cliPluginPackagesById = {
  contact_form: contactFormCliPluginPackage,
  analytics: analyticsCliPluginPackage,
  newsletter: newsletterCliPluginPackage,
} as const satisfies Record<InstalledPluginId, CliPluginPackage>;

export const installedCliPluginDescriptors = definePluginPackageDescriptors(
  installedPluginManifests.map(
    (manifest) => cliPluginPackagesById[manifest.pluginId],
  ) as readonly CliPluginPackage[],
);
