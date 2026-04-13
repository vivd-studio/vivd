import { buildSharedProjectPluginUiRegistry } from "@vivd/shared/types";
import { installedPluginManifests } from "./index";

export const installedStudioPluginDescriptors = installedPluginManifests;

export const installedStudioSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(installedStudioPluginDescriptors);
