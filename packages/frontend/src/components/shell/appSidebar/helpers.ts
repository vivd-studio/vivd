import * as React from "react";
import { buildHostOrigin } from "@/lib/localHostRouting";
import { getProjectLastModified } from "@/lib/project-utils";
import { trpc, type RouterOutputs } from "@/lib/trpc";

export type SidebarProject = RouterOutputs["project"]["list"]["projects"][number];
export type SwitcherOrganization =
  RouterOutputs["organization"]["listMyOrganizations"]["organizations"][number];
export type InstanceSoftware =
  RouterOutputs["superadmin"]["getInstanceSoftware"];
export type SidebarOrganization = {
  id: string;
  name: string;
  status: string;
} | null;
export type OrganizationTab =
  | "members"
  | "usage"
  | "maintenance"
  | "plugins"
  | "settings";
export type SuperAdminTab =
  | "instance"
  | "orgs"
  | "users"
  | "maintenance"
  | "machines"
  | "plugins"
  | "email";

export const ORG_SWITCH_QUERY_KEY = "__vivd_switch_org";

export function buildTenantStudioUrl(host: string, currentHost?: string): string {
  return `${buildHostOrigin(host, currentHost)}/vivd-studio`;
}

export function inferControlPlaneHostFallback(currentHost: string): string | null {
  const hostname = currentHost.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!hostname) return null;

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    // `*.localhost` cookies are tricky; prefer bouncing through plain localhost.
    return "localhost";
  }

  const firstDot = hostname.indexOf(".");
  if (firstDot === -1) return null;
  const baseDomain = hostname.slice(firstDot + 1).trim();
  if (!baseDomain) return null;

  // Matches our convention: `app.<TENANT_BASE_DOMAIN>` (e.g. app.vivd.studio).
  return `app.${baseDomain}`;
}

export function formatOrgRole(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "User";
    case "client_editor":
      return "Client Editor";
    default:
      return role;
  }
}

export function formatSidebarVersionLabel(
  software: InstanceSoftware | undefined,
): string | null {
  const raw = software?.currentVersion || software?.currentImageTag || null;
  if (!raw) return null;
  return raw.startsWith("v") ? raw : `v${raw}`;
}

export function useRecentProjects(): SidebarProject[] {
  const { data: projectsData } = trpc.project.list.useQuery(undefined, {
    // Keep data fresh for cross-tab/background updates without a heavy 5s loop.
    refetchInterval: 30_000,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const projects = projectsData?.projects;

  return React.useMemo(() => {
    if (!projects) return [];
    return [...projects].sort(
      (a, b) => getProjectLastModified(b) - getProjectLastModified(a),
    );
  }, [projects]);
}
