import type {
  PluginDefinition,
  PluginInfoSourcePayload,
  PluginModule,
  PluginOperationContext,
  PluginPublicErrorContext,
  PluginUpdateConfigContext,
} from "@vivd/shared/types";
import { analyticsPluginConfigSchema, type AnalyticsPluginConfig } from "./config";

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
} satisfies PluginDefinition<"analytics">;

export interface AnalyticsPluginInfoSource {
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: AnalyticsPluginConfig | null;
  snippets: {
    html: string;
    astro: string;
  } | null;
  usage: {
    scriptEndpoint: string;
    trackEndpoint: string;
    eventTypes: string[];
    respectDoNotTrack: boolean;
    captureQueryString: boolean;
    enableClientTracking: boolean;
  };
  instructions: string[];
}

export interface AnalyticsPluginBackendRuntime {
  ensurePlugin(options: PluginOperationContext): Promise<{
    instanceId: string;
    created: boolean;
    status: string;
  }>;
  getInfo(options: PluginOperationContext): Promise<AnalyticsPluginInfoSource>;
  updateConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: AnalyticsPluginConfig;
  }): Promise<AnalyticsPluginInfoSource>;
  isNotEnabledError(error: unknown): boolean;
}

function toAnalyticsInfoPayload(
  info: AnalyticsPluginInfoSource,
): PluginInfoSourcePayload {
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

export function createAnalyticsPluginModule(
  runtime: AnalyticsPluginBackendRuntime,
): PluginModule<"analytics"> {
  return {
    definition: analyticsPluginDefinition,
    ensureInstance(options) {
      return runtime.ensurePlugin(options);
    },
    async getInfoPayload(options) {
      return toAnalyticsInfoPayload(await runtime.getInfo(options));
    },
    async updateConfig(options: PluginUpdateConfigContext) {
      return toAnalyticsInfoPayload(
        await runtime.updateConfig({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          config: analyticsPluginConfigSchema.parse(options.config),
        }),
      );
    },
    mapPublicError(context: PluginPublicErrorContext) {
      if (runtime.isNotEnabledError(context.error)) {
        return {
          code: "UNAUTHORIZED",
          message:
            context.error instanceof Error
              ? context.error.message
              : "Analytics plugin is not enabled for this project.",
        };
      }
      return null;
    },
  };
}

export { analyticsPluginConfigSchema };
export type { AnalyticsPluginConfig };
