import { installedPluginManifests } from "@vivd/installed-plugins";
import {
  buildProjectPluginRoutePath,
  isNativePluginPackageManifest,
} from "@vivd/plugin-sdk";
import { Plug, type LucideIcon } from "lucide-react";
import { getPluginUiIcon } from "./icons";
import { getFrontendSharedProjectPluginUi } from "./sharedUiRegistry";

function humanizePluginId(pluginId: string): string {
  return pluginId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function getProjectPluginPresentation(
  pluginId: string,
  projectSlug?: string,
): {
  pluginId: string;
  title: string;
  openLabel: string;
  icon: LucideIcon;
  path: string | null;
} {
  const pluginUi = getFrontendSharedProjectPluginUi(pluginId);
  const iconName = pluginUi?.icon ?? pluginUi?.shortcut?.icon ?? null;

  return {
    pluginId,
    title: pluginUi?.pageTitle ?? humanizePluginId(pluginId),
    openLabel: pluginUi?.openLabel ?? "Open plugin",
    icon: iconName ? getPluginUiIcon(iconName) : Plug,
    path: projectSlug
      ? buildProjectPluginRoutePath(
          projectSlug,
          pluginId,
          pluginUi?.defaultSubpath
            ? {
                kind: "plugin-page",
                subpath: pluginUi.defaultSubpath,
              }
            : undefined,
        )
      : null,
  };
}

export type ProjectPluginPresentation = ReturnType<
  typeof getProjectPluginPresentation
>;

const nativeProjectPluginIds = new Set<string>(
  installedPluginManifests
    .filter(isNativePluginPackageManifest)
    .map((manifest) => manifest.pluginId),
);

export function isNativeProjectPluginId(pluginId: string): boolean {
  return nativeProjectPluginIds.has(pluginId);
}

export function listEnabledNativeProjectPluginPresentations(options: {
  enabledPluginIds?: readonly string[];
  projectSlug?: string;
}): ProjectPluginPresentation[] {
  const seen = new Set<string>();

  return (options.enabledPluginIds ?? [])
    .map((pluginId) => pluginId.trim())
    .filter((pluginId) => pluginId.length > 0)
    .filter((pluginId) => {
      if (!isNativeProjectPluginId(pluginId) || seen.has(pluginId)) {
        return false;
      }
      seen.add(pluginId);
      return true;
    })
    .map((pluginId) =>
      getProjectPluginPresentation(pluginId, options.projectSlug),
    );
}

export function isPluginAccessRequestPending(value?: {
  status?: "not_requested" | "pending" | null;
} | null): boolean {
  return value?.status === "pending";
}

export function getPluginAccessRequestLabel(value?: {
  status?: "not_requested" | "pending" | null;
} | null): string {
  return isPluginAccessRequestPending(value) ? "Request sent" : "Request access";
}
