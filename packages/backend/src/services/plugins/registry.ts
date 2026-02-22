import { z } from "zod";
import {
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./contactForm/config";

export const PLUGIN_IDS = ["contact_form"] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];

export { contactFormPluginConfigSchema };
export type { ContactFormPluginConfig };

type PluginCategory = "forms" | "marketing" | "commerce" | "utility";

export interface PluginManifest {
  pluginId: PluginId;
  name: string;
  description: string;
  category: PluginCategory;
  version: number;
  configSchema: z.ZodTypeAny;
  defaultConfig: Record<string, unknown>;
}

const pluginRegistry: Record<PluginId, PluginManifest> = {
  contact_form: {
    pluginId: "contact_form",
    name: "Contact Form",
    description: "Collect visitor inquiries and store submissions in Vivd.",
    category: "forms",
    version: 1,
    configSchema: contactFormPluginConfigSchema,
    defaultConfig: contactFormPluginConfigSchema.parse({}),
  },
};

export interface PluginCatalogEntry {
  pluginId: PluginId;
  name: string;
  description: string;
  category: PluginCategory;
  version: number;
}

export function listPluginCatalogEntries(): PluginCatalogEntry[] {
  return Object.values(pluginRegistry).map((plugin) => ({
    pluginId: plugin.pluginId,
    name: plugin.name,
    description: plugin.description,
    category: plugin.category,
    version: plugin.version,
  }));
}

export function getPluginManifest(pluginId: PluginId): PluginManifest {
  return pluginRegistry[pluginId];
}
