import type { PluginDefinition } from "../registry";
import type {
  PluginPublicErrorContext,
  PluginInfoSourcePayload,
  PluginModule,
  PluginOperationContext,
  PluginUpdateConfigContext,
} from "../core/module";
import {
  analyticsPluginConfigSchema,
  type AnalyticsPluginConfig,
} from "./config";
import {
  AnalyticsPluginNotEnabledError,
  analyticsPluginService,
} from "./service";

export const analyticsPluginDefinition = {
  pluginId: "analytics",
  name: "Analytics",
  description: "Track page traffic and visitor behavior for your project.",
  category: "marketing",
  version: 1,
  sortOrder: 20,
  configSchema: analyticsPluginConfigSchema,
  defaultConfig: analyticsPluginConfigSchema.parse({}),
  defaultEnabledByProfile: {
    solo: true,
    platform: false,
  },
  capabilities: {
    supportsInfo: true,
    config: {
      format: "json",
      supportsShow: true,
      supportsApply: true,
      supportsTemplate: true,
    },
    actions: [],
  },
  listUi: {
    projectPanel: "custom",
    usageLabel: "Events",
    limitPrompt:
      "Set monthly analytics event limit.\nLeave empty for unlimited.",
    supportsMonthlyLimit: true,
    supportsHardStop: true,
    supportsTurnstile: false,
    dashboardPath: "/analytics",
  },
} satisfies PluginDefinition;

async function getAnalyticsInfoPayload(
  options: PluginOperationContext,
): Promise<PluginInfoSourcePayload> {
  const info = await analyticsPluginService.getAnalyticsInfo(options);
  return {
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    config: info.config,
    snippets: info.snippets,
    usage: info.usage,
    details: null,
    instructions: info.instructions,
  };
}

async function updateAnalyticsConfigPayload(
  options: PluginUpdateConfigContext,
): Promise<PluginInfoSourcePayload> {
  await analyticsPluginService.updateAnalyticsConfig({
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    config: analyticsPluginConfigSchema.parse(options.config),
  });
  return getAnalyticsInfoPayload(options);
}

function mapAnalyticsPublicError(
  context: PluginPublicErrorContext,
) {
  if (context.error instanceof AnalyticsPluginNotEnabledError) {
    return {
      code: "UNAUTHORIZED" as const,
      message: context.error.message,
    };
  }
  return null;
}

export const analyticsPluginModule: PluginModule = {
  definition: analyticsPluginDefinition,
  async ensureInstance(options) {
    const result = await analyticsPluginService.ensureAnalyticsPlugin(options);
    return {
      instanceId: result.instanceId,
      created: result.created,
      status: result.status,
    };
  },
  getInfoPayload: getAnalyticsInfoPayload,
  updateConfig: updateAnalyticsConfigPayload,
  mapPublicError: mapAnalyticsPublicError,
};

export { analyticsPluginConfigSchema };
export type { AnalyticsPluginConfig };
