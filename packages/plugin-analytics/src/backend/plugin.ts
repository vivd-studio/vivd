import { analyticsPluginManifest } from "../manifest";
import { createAnalyticsPluginBackendContribution } from "./contribution";

export const analyticsBackendPluginPackage = {
  ...analyticsPluginManifest,
  backend: {
    createContribution: createAnalyticsPluginBackendContribution,
  },
} as const;
