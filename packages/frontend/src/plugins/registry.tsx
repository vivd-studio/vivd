import { getSharedProjectPluginUi } from "@vivd/plugin-sdk";
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

export function getProjectPluginOperatorPage(
  pluginId: string,
): ProjectPluginUiDefinition["OperatorPage"] | null {
  const componentUi = projectPluginComponentRegistry[pluginId];
  return componentUi?.OperatorPage ?? null;
}
