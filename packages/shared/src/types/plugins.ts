export const PLUGIN_UI_ICON_NAMES = [
  "bar-chart-3",
  "credit-card",
  "mail",
  "newspaper",
  "plug",
  "table-2",
] as const;

export type PluginUiIconName = (typeof PLUGIN_UI_ICON_NAMES)[number];

export const PROJECT_PLUGIN_SHORTCUT_SURFACES = [
  "navigation-search",
  "project-card",
  "project-header",
  "studio-mobile-menu",
  "studio-toolbar",
] as const;

export type ProjectPluginShortcutSurface =
  (typeof PROJECT_PLUGIN_SHORTCUT_SURFACES)[number];

export type ProjectPluginRouteTarget =
  | {
      kind: "plugin-page";
      subpath?: string;
    }
  | {
      kind: "project-section";
      path: string;
    };

export interface ProjectPluginShortcutSurfaceDefinition {
  surface: ProjectPluginShortcutSurface;
  showWhenDisabled?: boolean;
}

export interface ProjectPluginActivationSupportDefinition {
  title: string;
  description: string;
  supportSubject: string;
  supportActionLabel?: string;
}

export interface ProjectPluginShortcutDefinition {
  label: string;
  icon: PluginUiIconName;
  route?: ProjectPluginRouteTarget;
  keywords?: string[];
  expandedWidth?: number;
  surfaces: ProjectPluginShortcutSurfaceDefinition[];
  activationSupport?: ProjectPluginActivationSupportDefinition;
}

export interface SharedProjectPluginUiDefinition {
  pageTitle?: string;
  openLabel?: string;
  defaultSubpath?: string;
  shortcut?: ProjectPluginShortcutDefinition;
}

export type ProjectPluginUiRegistry = Record<
  string,
  SharedProjectPluginUiDefinition
>;

export interface ResolvedProjectPluginShortcutDefinition {
  pluginId: string;
  enabled: boolean;
  ui: SharedProjectPluginUiDefinition;
  shortcut: ProjectPluginShortcutDefinition;
  surface: ProjectPluginShortcutSurfaceDefinition;
}

function normalizeRoutePathSegment(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function buildProjectPluginRoutePath(
  projectSlug: string,
  pluginId: string,
  target?: ProjectPluginRouteTarget,
): string {
  const encodedSlug = encodeURIComponent(projectSlug);
  const resolvedTarget = target ?? { kind: "plugin-page" as const };

  if (resolvedTarget.kind === "project-section") {
    const normalizedPath = normalizeRoutePathSegment(resolvedTarget.path);
    return `/vivd-studio/projects/${encodedSlug}/${normalizedPath}`;
  }

  const encodedPluginId = encodeURIComponent(pluginId);
  const normalizedSubpath = resolvedTarget.subpath
    ? normalizeRoutePathSegment(resolvedTarget.subpath)
    : "";
  return `/vivd-studio/projects/${encodedSlug}/plugins/${encodedPluginId}${
    normalizedSubpath ? `/${normalizedSubpath}` : ""
  }`;
}

export function getSharedProjectPluginUi(
  pluginId: string,
  registry: ProjectPluginUiRegistry,
): SharedProjectPluginUiDefinition | null {
  return registry[pluginId] ?? null;
}

export function listProjectPluginShortcuts(options: {
  enabledPluginIds?: string[];
  registry: ProjectPluginUiRegistry;
  surface: ProjectPluginShortcutSurface;
}): ResolvedProjectPluginShortcutDefinition[] {
  const enabledPluginIds = new Set(options.enabledPluginIds ?? []);
  const shortcuts: ResolvedProjectPluginShortcutDefinition[] = [];

  for (const [pluginId, ui] of Object.entries(options.registry)) {
    const shortcut = ui.shortcut;
    if (!shortcut) continue;

    const surface = shortcut.surfaces.find(
      (candidate) => candidate.surface === options.surface,
    );
    if (!surface) continue;

    const enabled = enabledPluginIds.has(pluginId);
    if (!enabled && !surface.showWhenDisabled) continue;

    shortcuts.push({
      pluginId,
      enabled,
      ui,
      shortcut,
      surface,
    });
  }

  return shortcuts;
}
