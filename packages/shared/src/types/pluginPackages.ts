import type { PluginCliModule } from "./pluginCli.js";
import type { PluginDefinition } from "./pluginContracts.js";
import type { SharedProjectPluginUiDefinition } from "./plugins.js";

export interface PluginPackageDescriptor<
  TPluginId extends string = string,
  TFrontend = unknown,
  TBackend = unknown,
> {
  pluginId: TPluginId;
  definition: PluginDefinition<TPluginId>;
  sharedProjectUi?: SharedProjectPluginUiDefinition;
  cli?: PluginCliModule;
  frontend?: TFrontend;
  backend?: TBackend;
}
