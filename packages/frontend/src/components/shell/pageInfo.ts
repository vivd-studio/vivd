export interface PageInfo {
  title: string;
  isProjectPage: boolean;
  projectSlug?: string;
  isProjectPluginsPage?: boolean;
  isProjectAnalyticsPage?: boolean;
  isScratchWizardPage?: boolean;
}

export function getPageInfo(pathname: string): PageInfo {
  if (pathname === "/vivd-studio/projects/new/scratch") {
    return {
      title: "New project",
      isProjectPage: false,
      isScratchWizardPage: true,
    };
  }

  const projectAnalyticsMatch = pathname.match(
    /^\/vivd-studio\/projects\/([^/]+)\/analytics$/,
  );
  if (projectAnalyticsMatch) {
    return {
      title: "Analytics",
      isProjectPage: false,
      projectSlug: projectAnalyticsMatch[1],
      isProjectAnalyticsPage: true,
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
    isProjectPluginsPage: false,
    isProjectAnalyticsPage: false,
    isScratchWizardPage: false,
  };
}
