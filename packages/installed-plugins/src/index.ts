import {
  definePluginPackageDescriptors,
  definePluginPackageInstallDescriptors,
  extractPluginIds,
} from "@vivd/plugin-sdk";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";
import { newsletterPluginDescriptor } from "@vivd/plugin-newsletter/descriptor";

export const installedPluginDescriptors =
  definePluginPackageInstallDescriptors([
    contactFormPluginDescriptor,
    analyticsPluginDescriptor,
    newsletterPluginDescriptor,
  ] as const);

export const installedPluginManifests = definePluginPackageDescriptors(
  installedPluginDescriptors.map((descriptor) => descriptor.manifest) as readonly (
    typeof installedPluginDescriptors
  )[number]["manifest"][],
);

export const INSTALLED_PLUGIN_IDS = extractPluginIds(installedPluginManifests);
export type InstalledPluginId = (typeof INSTALLED_PLUGIN_IDS)[number];
export type InstalledPluginDescriptor =
  (typeof installedPluginDescriptors)[number];

export function listInstalledPluginAgentHints(
  enabledPluginIds?: readonly string[],
): string[] {
  const enabled = new Set(
    (enabledPluginIds ?? []).map((pluginId) => pluginId.trim()).filter(Boolean),
  );
  if (enabled.size === 0) return [];

  const seen = new Set<string>();
  const hints: string[] = [];

  for (const descriptor of installedPluginDescriptors) {
    if (!enabled.has(descriptor.pluginId)) continue;

    const definition = descriptor.manifest.definition;
    const agentHints =
      "agentHints" in definition && Array.isArray(definition.agentHints)
        ? definition.agentHints
        : [];

    for (const hint of agentHints) {
      const line = `${descriptor.manifest.definition.name}: ${hint}`;
      if (seen.has(line)) continue;
      seen.add(line);
      hints.push(line);
    }
  }

  return hints;
}
