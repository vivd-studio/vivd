import { getSharedProjectPluginUi } from "@vivd/shared/types";
import type { ProjectPluginUiDefinition } from "./types";
import { analyticsFrontendPluginModule } from "./analytics/module";
import { contactFormFrontendPluginModule } from "./contactForm/module";

const frontendPluginModules = [
  contactFormFrontendPluginModule,
  analyticsFrontendPluginModule,
];

const projectPluginComponentRegistry: Record<string, ProjectPluginUiDefinition> =
  Object.fromEntries(
    frontendPluginModules.flatMap((module) =>
      module.projectUi ? [[module.pluginId, module.projectUi]] : [],
    ),
  );

export function getProjectPluginUi(pluginId: string): ProjectPluginUiDefinition | null {
  const sharedUi = getSharedProjectPluginUi(pluginId);
  const componentUi = projectPluginComponentRegistry[pluginId];
  if (!sharedUi && !componentUi) return null;

  return {
    ...sharedUi,
    ...componentUi,
  };
}
