import {
  buildSharedProjectPluginUiRegistry,
  definePluginPackageDescriptors,
} from "@vivd/shared/types";
import type { ComponentType } from "react";
import type {
  PluginPackageDescriptor,
  SharedProjectPluginUiDefinition,
} from "@vivd/shared/types";
import { analyticsFrontendPluginPackage } from "@vivd/plugin-analytics/frontend/plugin";
import { contactFormFrontendPluginPackage } from "@vivd/plugin-contact-form/frontend/plugin";
import { newsletterFrontendPluginPackage } from "@vivd/plugin-newsletter/frontend/plugin";
import {
  installedPluginManifests,
  type InstalledPluginId,
} from "./index";

interface InstalledFrontendPluginModule {
  pluginId: string;
  projectUi?: SharedProjectPluginUiDefinition & {
    ProjectPage?: ComponentType<{
      projectSlug: string;
      isEmbedded?: boolean;
    }>;
  };
}

type FrontendPluginPackage = PluginPackageDescriptor<
  InstalledPluginId,
  InstalledFrontendPluginModule
>;

const frontendPluginPackagesById = {
  contact_form: contactFormFrontendPluginPackage,
  analytics: analyticsFrontendPluginPackage,
  newsletter: newsletterFrontendPluginPackage,
} as const satisfies Record<InstalledPluginId, FrontendPluginPackage>;

export const installedFrontendPluginDescriptors =
  definePluginPackageDescriptors(
    installedPluginManifests.map(
      (manifest) => frontendPluginPackagesById[manifest.pluginId],
    ) as readonly FrontendPluginPackage[],
  );

export const installedFrontendSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(installedFrontendPluginDescriptors);

export const installedFrontendPluginModules =
  installedFrontendPluginDescriptors.flatMap((descriptor) =>
    descriptor.frontend ? [descriptor.frontend] : [],
  );
