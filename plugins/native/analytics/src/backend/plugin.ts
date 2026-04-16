import type { NativePluginBackendPackage } from "@vivd/plugin-sdk";
import { analyticsPluginManifest } from "../manifest";
import type {
  AnalyticsPluginBackendContribution,
} from "./contribution";
import { createAnalyticsPluginBackendContribution } from "./contribution";
import type { AnalyticsPluginBackendContributionDeps } from "./ports";

export const analyticsBackendPluginPackage = {
  ...analyticsPluginManifest,
  backend: {
    createContribution: createAnalyticsPluginBackendContribution,
  },
} as const satisfies NativePluginBackendPackage<
  "analytics",
  AnalyticsPluginBackendContributionDeps,
  AnalyticsPluginBackendContribution
>;

export default analyticsBackendPluginPackage;
