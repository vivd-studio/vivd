import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsCliModule } from "./cli/module";
import { analyticsPluginDefinition } from "./backend/module";
import { analyticsSharedProjectUi } from "./shared/projectUi";

export const analyticsPluginDescriptor = {
  pluginId: analyticsPluginDefinition.pluginId,
  definition: analyticsPluginDefinition,
  sharedProjectUi: analyticsSharedProjectUi,
  cli: analyticsCliModule,
} satisfies PluginPackageDescriptor<"analytics">;
