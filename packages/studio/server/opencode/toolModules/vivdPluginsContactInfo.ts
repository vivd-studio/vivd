import type { OpencodeToolDefinition } from "./types.js";
import { callTrpcQuery, getRuntimeConfig, validateConnectedRuntime } from "./runtime.js";

export const vivdPluginsContactInfoToolDefinition: OpencodeToolDefinition = {
  description:
    "Get complete Contact Form plugin usage info and implementation instructions for the current project.",
  args: {},
  async execute() {
    const config = getRuntimeConfig();
    const validationError = validateConnectedRuntime(config, "vivd_plugins_contact_info");
    if (validationError) return validationError;

    const payload = await callTrpcQuery(
      "studioApi.getProjectContactPluginInfo",
      {
        studioId: config.studioId,
        slug: config.projectSlug,
      },
      config,
    );

    return JSON.stringify(
      {
        tool: "vivd_plugins_contact_info",
        ok: true,
        ...payload,
      },
      null,
      2,
    );
  },
};
