import {
  buildSharedProjectPluginUiRegistry,
  definePluginPackageDescriptors,
} from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsFrontendPluginPackage } from "@vivd/plugin-analytics/frontend/plugin";
import { contactFormFrontendPluginPackage } from "@vivd/plugin-contact-form/frontend/plugin";
import { newsletterFrontendPluginPackage } from "@vivd/plugin-newsletter/frontend/plugin";
import type { FrontendPluginModule } from "./types";

type FrontendPluginDescriptor = PluginPackageDescriptor<string, FrontendPluginModule>;

export const frontendPluginDescriptors = definePluginPackageDescriptors([
  contactFormFrontendPluginPackage,
  analyticsFrontendPluginPackage,
  newsletterFrontendPluginPackage,
] as const satisfies readonly FrontendPluginDescriptor[]);

export const frontendSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(frontendPluginDescriptors);

export const frontendPluginModules = frontendPluginDescriptors.flatMap(
  (descriptor) => (descriptor.frontend ? [descriptor.frontend] : []),
);
