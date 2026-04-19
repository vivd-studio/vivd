import {
  buildProjectPluginRoutePath,
  listProjectPluginShortcuts,
  type ProjectPluginShortcutSurface,
  type ProjectPluginActivationSupportDefinition,
} from "@vivd/plugin-sdk";
import type { LucideIcon } from "lucide-react";
import { getPluginUiIcon } from "./icons";
import { isNativeProjectPluginId } from "./presentation";
import { frontendSharedProjectPluginUiRegistry } from "./sharedUiRegistry";

export interface ResolvedProjectPluginShortcut {
  pluginId: string;
  enabled: boolean;
  label: string;
  path: string;
  icon: LucideIcon;
  keywords: string[];
  expandedWidth?: number;
  activationSupport?: ProjectPluginActivationSupportDefinition;
}

export function getProjectPluginShortcuts(options: {
  enabledPluginIds?: string[];
  projectSlug: string;
  surface: ProjectPluginShortcutSurface;
}): ResolvedProjectPluginShortcut[] {
  return listProjectPluginShortcuts({
    enabledPluginIds: options.enabledPluginIds,
    registry: frontendSharedProjectPluginUiRegistry,
    surface: options.surface,
  })
    .filter((entry) => isNativeProjectPluginId(entry.pluginId))
    .map((entry) => ({
      pluginId: entry.pluginId,
      enabled: entry.enabled,
      label: entry.shortcut.label,
      path: buildProjectPluginRoutePath(
        options.projectSlug,
        entry.pluginId,
        entry.shortcut.route,
      ),
      icon: getPluginUiIcon(entry.shortcut.icon),
      keywords: entry.shortcut.keywords ?? [],
      expandedWidth: entry.shortcut.expandedWidth,
      activationSupport: entry.shortcut.activationSupport,
    }));
}
