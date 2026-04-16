import type {
  PluginDefinition,
  PluginInfoSourcePayload,
  PluginModule,
  PluginOperationContext,
  PluginPublicErrorContext,
  PluginReadContext,
  PluginUpdateConfigContext,
  ProjectPluginReadPayload,
} from "@vivd/plugin-sdk";
import { UnsupportedPluginReadError } from "@vivd/plugin-sdk";
import { analyticsPluginConfigSchema, type AnalyticsPluginConfig } from "./config";
import {
  ANALYTICS_SUMMARY_READ_ID,
  analyticsSummaryReadDefinition,
  analyticsSummaryReadInputSchema,
  type AnalyticsSummaryPayload,
  type AnalyticsSummaryRange,
} from "../shared/summary";

export const analyticsPluginDefinition = {
  pluginId: "analytics",
  kind: "native",
  name: "Analytics",
  description: "Track page traffic and visitor behavior for your project.",
  category: "marketing",
  version: 1,
  sortOrder: 20,
  configSchema: analyticsPluginConfigSchema,
  defaultConfig: analyticsPluginConfigSchema.parse({}),
  capabilities: {
    supportsInfo: true,
    config: {
      format: "json",
      supportsShow: true,
      supportsApply: true,
      supportsTemplate: true,
    },
    actions: [],
    reads: [analyticsSummaryReadDefinition],
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
  readSummary(options: {
    organizationId: string;
    projectSlug: string;
    rangeDays: AnalyticsSummaryRange;
  }): Promise<AnalyticsSummaryPayload>;
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

async function runAnalyticsRead(
  runtime: AnalyticsPluginBackendRuntime,
  options: PluginReadContext,
): Promise<ProjectPluginReadPayload<"analytics">> {
  if (options.readId !== ANALYTICS_SUMMARY_READ_ID) {
    throw new UnsupportedPluginReadError("analytics", options.readId);
  }

  const input = analyticsSummaryReadInputSchema.parse(options.input);
  return {
    pluginId: "analytics",
    readId: options.readId,
    result: await runtime.readSummary({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      rangeDays: input.rangeDays,
    }),
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
    runRead(options) {
      return runAnalyticsRead(runtime, options);
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
