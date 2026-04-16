import { buildSharedProjectPluginUiRegistry } from "@vivd/plugin-sdk";
import { installedPluginManifests } from "./index";

export const installedStudioPluginDescriptors = installedPluginManifests;

export const installedStudioSharedProjectPluginUiRegistry =
  buildSharedProjectPluginUiRegistry(installedStudioPluginDescriptors);
