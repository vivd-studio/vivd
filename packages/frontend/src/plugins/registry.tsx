import { getSharedProjectPluginUi } from "@vivd/shared/types";
import type { ProjectPluginUiDefinition } from "./types";
import {
  frontendPluginModules,
  frontendSharedProjectPluginUiRegistry,
} from "./descriptors";

const projectPluginComponentRegistry: Record<string, ProjectPluginUiDefinition> =
  Object.fromEntries(
    frontendPluginModules.flatMap((module) =>
      module.projectUi ? [[module.pluginId, module.projectUi]] : [],
    ),
  );

export function getProjectPluginUi(pluginId: string): ProjectPluginUiDefinition | null {
  const sharedUi = getSharedProjectPluginUi(
    pluginId,
    frontendSharedProjectPluginUiRegistry,
  );
  const componentUi = projectPluginComponentRegistry[pluginId];
  if (!sharedUi && !componentUi) return null;

  return {
    ...sharedUi,
    ...componentUi,
  };
}
