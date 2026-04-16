import { getFrontendSharedProjectPluginUi } from "@/plugins/sharedUiRegistry";

export const BRAND_NAME = "Vivd";

const ENV_SUFFIX = (() => {
  const env = import.meta.env.VITE_APP_ENV?.toLowerCase();
  if (env?.includes("staging")) return " (Staging)";
  if (env?.includes("local") || env?.includes("dev")) return " (Local)";
  return "";
})();

export function formatDocumentTitle(pageTitle?: string) {
  const brandLabel = `${BRAND_NAME}${ENV_SUFFIX}`;
  if (!pageTitle) return brandLabel;
  return `${pageTitle} · ${brandLabel}`;
}

function formatProjectLabel(slug: string) {
  const cleaned = slug.trim().replace(/[-_]+/g, " ");
  if (!cleaned) return "Project";
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPluginLabel(pluginId: string) {
  const pluginUi = getFrontendSharedProjectPluginUi(pluginId);
  if (pluginUi?.pageTitle) return pluginUi.pageTitle;
  if (pluginUi?.shortcut?.label) return pluginUi.shortcut.label;
  return formatProjectLabel(pluginId);
}

function getOrganizationTitle(searchParams: URLSearchParams) {
  const tab = searchParams.get("tab");
  switch (tab) {
    case "usage":
      return "Organization Usage";
    case "maintenance":
      return "Organization Maintenance";
    case "plugins":
      return "Organization Plugins";
    case "settings":
      return "Organization Settings";
    default:
      return "Organization Members";
  }
}

function getSuperAdminTitle(searchParams: URLSearchParams) {
  const section = searchParams.get("section");
  switch (section) {
    case "org":
      return "Organizations";
    case "users":
      return "System Users";
    case "maintenance":
      return "Maintenance";
    case "machines":
      return "Machines";
    case "plugins":
      return "Plugins";
    case "email":
      return "Email";
    default:
      return "Instance";
  }
}

export function getRouteDocumentTitle(pathname: string, search = "") {
  const searchParams = new URLSearchParams(search);

  if (pathname === "/vivd-studio/login") {
    return formatDocumentTitle("Login");
  }
  if (pathname === "/vivd-studio/forgot-password") {
    return formatDocumentTitle("Forgot Password");
  }
  if (pathname === "/vivd-studio/reset-password") {
    return formatDocumentTitle("Set New Password");
  }
  if (pathname === "/vivd-studio/settings") {
    return formatDocumentTitle("Settings");
  }
  if (pathname === "/vivd-studio/org") {
    return formatDocumentTitle(getOrganizationTitle(searchParams));
  }
  if (pathname === "/vivd-studio/no-project") {
    return formatDocumentTitle("No Project Assigned");
  }
  if (pathname === "/vivd-studio/single-project") {
    return formatDocumentTitle("Project");
  }
  if (pathname.startsWith("/vivd-studio/superadmin")) {
    return formatDocumentTitle(getSuperAdminTitle(searchParams));
  }
  if (pathname === "/vivd-studio/projects/new/scratch") {
    return formatDocumentTitle("Create Site");
  }

  const projectPluginMatch = pathname.match(
    /^\/vivd-studio\/projects\/([^/]+)\/plugins\/([^/]+)(?:\/.*)?$/,
  );
  if (projectPluginMatch) {
    const [, slug = "", pluginId = ""] = projectPluginMatch;
    const projectLabel = formatProjectLabel(decodeURIComponent(slug));
    const pluginLabel = formatPluginLabel(decodeURIComponent(pluginId));
    return formatDocumentTitle(`${projectLabel} ${pluginLabel}`);
  }

  const projectMatch = pathname.match(
    /^\/vivd-studio\/projects\/([^/]+)(?:\/(plugins|fullscreen|studio-fullscreen))?$/,
  );
  if (projectMatch) {
    const [, slug = "", section] = projectMatch;
    const projectLabel = formatProjectLabel(decodeURIComponent(slug));
    if (section === "plugins") {
      return formatDocumentTitle(`${projectLabel} Plugins`);
    }
    if (section === "fullscreen") {
      return formatDocumentTitle(`${projectLabel} Preview`);
    }
    if (section === "studio-fullscreen") {
      return formatDocumentTitle(`${projectLabel} Studio`);
    }
    return formatDocumentTitle(projectLabel);
  }

  if (pathname === "/vivd-studio" || pathname === "/vivd-studio/") {
    return formatDocumentTitle("Projects");
  }

  return formatDocumentTitle();
}
