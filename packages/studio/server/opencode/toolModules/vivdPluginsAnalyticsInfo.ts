import type { OpencodeToolDefinition } from "./types.js";
import { callTrpcQuery, getRuntimeConfig, validateConnectedRuntime } from "./runtime.js";

export const vivdPluginsAnalyticsInfoToolDefinition: OpencodeToolDefinition = {
  description:
    "Get complete Analytics plugin usage info and implementation instructions for the current project.",
  args: {},
  async execute() {
    const config = getRuntimeConfig();
    const validationError = validateConnectedRuntime(config, "vivd_plugins_analytics_info");
    if (validationError) return validationError;

    const payload = await callTrpcQuery(
      "studioApi.getProjectAnalyticsPluginInfo",
      {
        studioId: config.studioId,
        slug: config.projectSlug,
      },
      config,
    );

    return JSON.stringify(
      {
        tool: "vivd_plugins_analytics_info",
        ok: true,
        ...payload,
      },
      null,
      2,
    );
  },
};
