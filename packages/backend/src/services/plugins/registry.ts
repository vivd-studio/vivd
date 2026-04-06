import { z } from "zod";
import {
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./contactForm/config";
import {
  analyticsPluginConfigSchema,
  type AnalyticsPluginConfig,
} from "./analytics/config";

export const PLUGIN_IDS = ["contact_form", "analytics"] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];
export type PluginCategory = "forms" | "marketing" | "commerce" | "utility";
export type PluginProjectPanelKind = "custom" | "generic";

export { contactFormPluginConfigSchema };
export type { ContactFormPluginConfig };
export { analyticsPluginConfigSchema };
export type { AnalyticsPluginConfig };

export interface PluginDefinition {
  pluginId: PluginId;
  name: string;
  description: string;
  category: PluginCategory;
  version: number;
  sortOrder: number;
  configSchema: z.ZodTypeAny;
  defaultConfig: Record<string, unknown>;
  defaultEnabledByProfile: {
    solo: boolean;
    platform: boolean;
  };
  listUi: {
    projectPanel: PluginProjectPanelKind;
    usageLabel: string;
    limitPrompt: string;
    supportsMonthlyLimit: boolean;
    supportsHardStop: boolean;
    supportsTurnstile: boolean;
    dashboardPath: string | null;
  };
}

const pluginRegistry: Record<PluginId, PluginDefinition> = {
  contact_form: {
    pluginId: "contact_form",
    name: "Contact Form",
    description: "Collect visitor inquiries and store submissions in Vivd.",
    category: "forms",
    version: 1,
    sortOrder: 10,
    configSchema: contactFormPluginConfigSchema,
    defaultConfig: contactFormPluginConfigSchema.parse({}),
    defaultEnabledByProfile: {
      solo: true,
      platform: false,
    },
    listUi: {
      projectPanel: "custom",
      usageLabel: "Submissions",
      limitPrompt:
        "Set monthly contact form submission limit.\nLeave empty for unlimited.",
      supportsMonthlyLimit: true,
      supportsHardStop: true,
      supportsTurnstile: true,
      dashboardPath: null,
    },
  },
  analytics: {
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
    listUi: {
      projectPanel: "custom",
      usageLabel: "Events",
      limitPrompt: "Set monthly analytics event limit.\nLeave empty for unlimited.",
      supportsMonthlyLimit: true,
      supportsHardStop: true,
      supportsTurnstile: false,
      dashboardPath: "/analytics",
    },
  },
};

export interface PluginCatalogEntry {
  pluginId: PluginId;
  name: string;
  description: string;
  category: PluginCategory;
  version: number;
  sortOrder: number;
  projectPanel: PluginProjectPanelKind;
  usageLabel: string;
  limitPrompt: string;
  supportsMonthlyLimit: boolean;
  supportsHardStop: boolean;
  supportsTurnstile: boolean;
  dashboardPath: string | null;
}

export function listPluginCatalogEntries(): PluginCatalogEntry[] {
  return listPluginDefinitions().map((plugin) => ({
    pluginId: plugin.pluginId,
    name: plugin.name,
    description: plugin.description,
    category: plugin.category,
    version: plugin.version,
    sortOrder: plugin.sortOrder,
    projectPanel: plugin.listUi.projectPanel,
    usageLabel: plugin.listUi.usageLabel,
    limitPrompt: plugin.listUi.limitPrompt,
    supportsMonthlyLimit: plugin.listUi.supportsMonthlyLimit,
    supportsHardStop: plugin.listUi.supportsHardStop,
    supportsTurnstile: plugin.listUi.supportsTurnstile,
    dashboardPath: plugin.listUi.dashboardPath,
  }));
}

export function listPluginDefinitions(): PluginDefinition[] {
  return [...Object.values(pluginRegistry)].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
}

export function getPluginDefinition(pluginId: PluginId): PluginDefinition {
  return pluginRegistry[pluginId];
}

export function getPluginDefaultEnabledByProfile(
  pluginId: PluginId,
  profile: "solo" | "platform",
): boolean {
  return pluginRegistry[pluginId].defaultEnabledByProfile[profile];
}

export const getPluginManifest = getPluginDefinition;
