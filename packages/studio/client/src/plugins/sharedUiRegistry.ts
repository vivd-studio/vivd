import type { ProjectPluginUiRegistry } from "@vivd/shared/types";
import { analyticsSharedProjectUi } from "@vivd/plugin-analytics/shared/projectUi";

export const studioSharedProjectPluginUiRegistry = {
  analytics: analyticsSharedProjectUi,
} satisfies ProjectPluginUiRegistry;
