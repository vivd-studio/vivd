import {
  buildSharedProjectPluginUiRegistry,
  definePluginPackageDescriptors,
} from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsFrontendPluginPackage } from "@vivd/plugin-analytics/frontend/plugin";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";
import { contactFormFrontendPluginModule } from "./contactForm/module";
import type { FrontendPluginModule } from "./types";

type FrontendPluginDescriptor = PluginPackageDescriptor<string, FrontendPluginModule>;

export const frontendPluginDescriptors = definePluginPackageDescriptors([
  {
    ...contactFormPluginDescriptor,
    frontend: contactFormFrontendPluginModule,
  },
  analyticsFrontendPluginPackage,
] as const satisfies readonly FrontendPluginDescriptor[]);

export const frontendSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(frontendPluginDescriptors);

export const frontendPluginModules = frontendPluginDescriptors.flatMap(
  (descriptor) => (descriptor.frontend ? [descriptor.frontend] : []),
);
