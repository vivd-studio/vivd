import {
  definePluginPackageDescriptors,
  extractPluginIds,
} from "@vivd/plugin-sdk";
import { analyticsPluginManifest } from "@vivd/plugin-analytics/manifest";
import { contactFormPluginManifest } from "@vivd/plugin-contact-form/manifest";
import { newsletterPluginManifest } from "@vivd/plugin-newsletter/manifest";

export const installedPluginManifests = definePluginPackageDescriptors([
  contactFormPluginManifest,
  analyticsPluginManifest,
  newsletterPluginManifest,
] as const);

export const INSTALLED_PLUGIN_IDS = extractPluginIds(installedPluginManifests);
export type InstalledPluginId = (typeof INSTALLED_PLUGIN_IDS)[number];

export function mapInstalledPluginsById<
  const TById extends Record<InstalledPluginId, unknown>,
>(
  pluginsById: TById,
): Array<TById[InstalledPluginId]> {
  return installedPluginManifests.map(
    (manifest) => pluginsById[manifest.pluginId],
  );
}

export function listInstalledPluginAgentHints(
  enabledPluginIds?: readonly string[],
): string[] {
  const enabled = new Set(
    (enabledPluginIds ?? []).map((pluginId) => pluginId.trim()).filter(Boolean),
  );
  if (enabled.size === 0) return [];

  const seen = new Set<string>();
  const hints: string[] = [];

  for (const manifest of installedPluginManifests) {
    if (!enabled.has(manifest.pluginId)) continue;

    const definition = manifest.definition;
    const agentHints =
      "agentHints" in definition && Array.isArray(definition.agentHints)
        ? definition.agentHints
        : [];

    for (const hint of agentHints) {
      const line = `${manifest.definition.name}: ${hint}`;
      if (seen.has(line)) continue;
      seen.add(line);
      hints.push(line);
    }
  }

  return hints;
}
