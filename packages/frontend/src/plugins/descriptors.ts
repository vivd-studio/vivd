import type {
  PluginPackageDescriptor,
  ProjectPluginUiRegistry,
} from "@vivd/shared/types";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";
import { analyticsFrontendPluginModule } from "./analytics/module";
import { contactFormFrontendPluginModule } from "./contactForm/module";
import type { FrontendPluginModule } from "./types";

type FrontendPluginDescriptor = PluginPackageDescriptor<string, FrontendPluginModule>;

export const frontendPluginDescriptors = [
  {
    ...contactFormPluginDescriptor,
    frontend: contactFormFrontendPluginModule,
  },
  {
    ...analyticsPluginDescriptor,
    frontend: analyticsFrontendPluginModule,
  },
] satisfies readonly FrontendPluginDescriptor[];

export const frontendSharedProjectPluginUiRegistry = Object.fromEntries(
  frontendPluginDescriptors.flatMap((descriptor) =>
    descriptor.sharedProjectUi
      ? [[descriptor.pluginId, descriptor.sharedProjectUi] as const]
      : [],
  ),
) satisfies ProjectPluginUiRegistry;

export const frontendPluginModules = frontendPluginDescriptors.flatMap(
  (descriptor) => (descriptor.frontend ? [descriptor.frontend] : []),
);
