export { frontendSharedProjectPluginUiRegistry } from "./descriptors";

import { getSharedProjectPluginUi } from "@vivd/plugin-sdk";
import { frontendSharedProjectPluginUiRegistry } from "./descriptors";

export function getFrontendSharedProjectPluginUi(pluginId: string) {
  return getSharedProjectPluginUi(pluginId, frontendSharedProjectPluginUiRegistry);
}
