import {
  buildSharedProjectPluginUiRegistry,
  definePluginPackageDescriptors,
} from "@vivd/shared/types";
import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";
import { analyticsFrontendPluginModule } from "./analytics/module";
import { contactFormFrontendPluginModule } from "./contactForm/module";
import type { FrontendPluginModule } from "./types";

type FrontendPluginDescriptor = PluginPackageDescriptor<string, FrontendPluginModule>;

export const frontendPluginDescriptors = definePluginPackageDescriptors([
  {
    ...contactFormPluginDescriptor,
    frontend: contactFormFrontendPluginModule,
  },
  {
    ...analyticsPluginDescriptor,
    frontend: analyticsFrontendPluginModule,
  },
] as const satisfies readonly FrontendPluginDescriptor[]);

export const frontendSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(frontendPluginDescriptors);

export const frontendPluginModules = frontendPluginDescriptors.flatMap(
  (descriptor) => (descriptor.frontend ? [descriptor.frontend] : []),
);
