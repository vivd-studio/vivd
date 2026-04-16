import { getFrontendSharedProjectPluginUi } from "@/plugins/sharedUiRegistry";

export interface PageInfo {
  title: string;
  isProjectPage: boolean;
  usesImmersiveSidebar?: boolean;
  projectSlug?: string;
  isProjectPluginsPage?: boolean;
  isProjectPluginPage?: boolean;
  projectPluginId?: string;
  isScratchWizardPage?: boolean;
}

function formatPluginPageTitle(pluginId: string) {
  const pluginUi = getFrontendSharedProjectPluginUi(pluginId);
  if (pluginUi?.pageTitle) return pluginUi.pageTitle;
  if (pluginUi?.shortcut?.label) return pluginUi.shortcut.label;

  const normalized = pluginId.trim().replace(/[-_]+/g, " ");
  if (!normalized) return "Plugin";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getPageInfo(pathname: string): PageInfo {
  if (pathname === "/vivd-studio/projects/new/scratch") {
    return {
      title: "New project",
      isProjectPage: false,
      usesImmersiveSidebar: true,
      isScratchWizardPage: true,
    };
  }

  const projectPluginMatch = pathname.match(
    /^\/vivd-studio\/projects\/([^/]+)\/plugins\/([^/]+)(?:\/.*)?$/,
  );
  if (projectPluginMatch) {
    const [, projectSlug = "", pluginId = ""] = projectPluginMatch;
    return {
      title: formatPluginPageTitle(decodeURIComponent(pluginId)),
      isProjectPage: false,
      projectSlug: decodeURIComponent(projectSlug),
      isProjectPluginPage: true,
      projectPluginId: decodeURIComponent(pluginId),
    };
  }

  const projectPluginsMatch = pathname.match(
    /^\/vivd-studio\/projects\/([^/]+)\/plugins$/,
  );
  if (projectPluginsMatch) {
    return {
      title: "Plugins",
      isProjectPage: false,
      projectSlug: projectPluginsMatch[1],
      isProjectPluginsPage: true,
    };
  }

  const projectMatch = pathname.match(/^\/vivd-studio\/projects\/([^/]+)$/);
  if (projectMatch) {
    return {
      title: "Projects",
      isProjectPage: true,
      usesImmersiveSidebar: true,
      projectSlug: projectMatch[1],
    };
  }

  if (pathname === "/vivd-studio" || pathname === "/vivd-studio/") {
    return { title: "Projects", isProjectPage: false };
  }
  if (pathname.startsWith("/vivd-studio/superadmin")) {
    return { title: "Super Admin", isProjectPage: false };
  }
  if (pathname.startsWith("/vivd-studio/org")) {
    return { title: "Organization", isProjectPage: false };
  }
  if (pathname.startsWith("/vivd-studio/settings")) {
    return { title: "Settings", isProjectPage: false };
  }
  if (pathname.startsWith("/vivd-studio/no-project")) {
    return { title: "No Project", isProjectPage: false };
  }
  return {
    title: "Projects",
    isProjectPage: false,
    usesImmersiveSidebar: false,
    isProjectPluginsPage: false,
    isProjectPluginPage: false,
    isScratchWizardPage: false,
  };
}
