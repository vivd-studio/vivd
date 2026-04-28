import { getFrontendSharedProjectPluginUi } from "@/plugins/sharedUiRegistry";

export interface PageInfo {
  title: string;
  isProjectPage: boolean;
  projectSlug?: string;
  isProjectPluginsPage?: boolean;
  isProjectPluginPage?: boolean;
  projectPluginId?: string;
  isScratchWizardPage?: boolean;
  isProjectsIndexPage?: boolean;
}

function formatPluginPageTitle(pluginId: string) {
  const pluginUi = getFrontendSharedProjectPluginUi(pluginId);
  if (pluginUi?.pageTitle) return pluginUi.pageTitle;
  if (pluginUi?.shortcut?.label) return pluginUi.shortcut.label;

  const normalized = pluginId.trim().replace(/[-_]+/g, " ");
  if (!normalized) return "Plugin";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizePathname(pathname: string) {
  if (pathname.length <= 1) return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function getPageInfo(pathname: string): PageInfo {
  const normalizedPathname = normalizePathname(pathname);

  if (normalizedPathname === "/vivd-studio/projects/new/scratch") {
    return {
      title: "New project",
      isProjectPage: false,
      isScratchWizardPage: true,
    };
  }

  const projectPluginMatch = normalizedPathname.match(
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

  const projectPluginsMatch = normalizedPathname.match(
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

  const projectMatch = normalizedPathname.match(
    /^\/vivd-studio\/projects\/([^/]+)$/,
  );
  if (projectMatch) {
    return {
      title: "Projects",
      isProjectPage: true,
      projectSlug: projectMatch[1],
    };
  }

  if (normalizedPathname === "/vivd-studio") {
    return {
      title: "Projects",
      isProjectPage: false,
      isProjectsIndexPage: true,
    };
  }
  if (normalizedPathname.startsWith("/vivd-studio/superadmin")) {
    return { title: "Super Admin", isProjectPage: false };
  }
  if (normalizedPathname.startsWith("/vivd-studio/org")) {
    return { title: "Organization", isProjectPage: false };
  }
  if (normalizedPathname.startsWith("/vivd-studio/settings")) {
    return { title: "Settings", isProjectPage: false };
  }
  if (normalizedPathname.startsWith("/vivd-studio/no-project")) {
    return { title: "No Project", isProjectPage: false };
  }
  return {
    title: "Projects",
    isProjectPage: false,
    isProjectPluginsPage: false,
    isProjectPluginPage: false,
    isScratchWizardPage: false,
  };
}
