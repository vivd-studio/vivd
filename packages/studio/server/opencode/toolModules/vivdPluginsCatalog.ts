import type { OpencodeToolDefinition } from "./types.js";
import { callTrpcQuery, getRuntimeConfig, validateConnectedRuntime } from "./runtime.js";

export const vivdPluginsCatalogToolDefinition: OpencodeToolDefinition = {
  description: "List available Vivd plugins and enabled plugin instances for the current project.",
  args: {},
  async execute() {
    const config = getRuntimeConfig();
    const validationError = validateConnectedRuntime(config, "vivd_plugins_catalog");
    if (validationError) return validationError;

    const payload = await callTrpcQuery(
      "plugins.catalog",
      { slug: config.projectSlug },
      config,
    );

    return JSON.stringify(
      {
        tool: "vivd_plugins_catalog",
        ok: true,
        project: payload?.project || { slug: config.projectSlug },
        available: payload?.available || [],
        instances: payload?.instances || [],
      },
      null,
      2,
    );
  },
};
