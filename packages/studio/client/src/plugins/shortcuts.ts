import {
  buildProjectPluginRoutePath,
  listProjectPluginShortcuts,
  type ProjectPluginShortcutSurface,
  type ProjectPluginActivationSupportDefinition,
} from "@vivd/plugin-sdk";
import type { LucideIcon } from "lucide-react";
import { getPluginUiIcon } from "./icons";
import { studioSharedProjectPluginUiRegistry } from "./sharedUiRegistry";

export interface StudioProjectPluginShortcut {
  pluginId: string;
  enabled: boolean;
  label: string;
  path: string;
  icon: LucideIcon;
  expandedWidth?: number;
  activationSupport?: ProjectPluginActivationSupportDefinition;
}

export function getStudioProjectPluginShortcuts(options: {
  enabledPluginIds?: string[];
  projectSlug: string;
  surface: ProjectPluginShortcutSurface;
}): StudioProjectPluginShortcut[] {
  return listProjectPluginShortcuts({
    enabledPluginIds: options.enabledPluginIds,
    registry: studioSharedProjectPluginUiRegistry,
    surface: options.surface,
  }).map((entry) => ({
    pluginId: entry.pluginId,
    enabled: entry.enabled,
    label: entry.shortcut.label,
    path: buildProjectPluginRoutePath(
      options.projectSlug,
      entry.pluginId,
      entry.shortcut.route,
    ),
    icon: getPluginUiIcon(entry.shortcut.icon),
    expandedWidth: entry.shortcut.expandedWidth,
    activationSupport: entry.shortcut.activationSupport,
  }));
}
