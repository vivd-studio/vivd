import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { buildDocsUrl } from "@/lib/docsUrl";
import { useAppConfig } from "@/lib/AppConfigContext";
import { ROUTES } from "@/app/router";
import { trpc } from "@/lib/trpc";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useNavigationSearch } from "./navigationSearchContext";
import { useAppSidebarOrganizationSwitching } from "./appSidebar/organizationSwitching";
import {
  useRecentProjects,
  type OrganizationTab,
  type SuperAdminTab,
} from "./appSidebar/helpers";
import {
  OrganizationSwitcher,
  SidebarVersionIndicator,
  UserMenu,
} from "./appSidebar/menus";
import {
  PlatformNavSection,
  SidebarSearchButton,
  SuperAdminNavSection,
} from "./appSidebar/navSections";

export function AppSidebar() {
  const { data: session } = authClient.useSession();
  const { config, isLoading: isConfigLoading } = useAppConfig();
  const location = useLocation();
  const navigate = useNavigate();
  const { state, isImmersiveDesktop } = useSidebar();
  const { openSearch } = useNavigationSearch();

  const isCollapsed = state === "collapsed";
  const showImmersiveSidebarToggle = isCollapsed && isImmersiveDesktop;
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const showPlatformAdminSections =
    config.showPlatformAdminSections ?? (config.installProfile === "platform");
  const instanceSectionLabel =
    config.instanceSectionLabel ??
    (config.instanceAdminLabel === "Instance Settings" ? "General" : "Instance");

  const { data: membership } = trpc.organization.getMyMembership.useQuery(undefined, {
    enabled: !!session && config.hasHostOrganizationAccess,
  });
  const isOrgAdmin = !!membership?.isOrganizationAdmin;
  const isOrgOwner =
    membership?.organizationRole === "owner" ||
    session?.user?.role === "super_admin";
  const showOrganizationAdmin = isOrgAdmin;

  const isSuperAdmin = session?.user?.role === "super_admin";
  const showSuperAdmin = isSuperAdmin && !isConfigLoading && config.isSuperAdminHost;
  const { data: instanceSoftware } = trpc.superadmin.getInstanceSoftware.useQuery(undefined, {
    enabled: showSuperAdmin,
    staleTime: 60_000,
    retry: false,
  });

  const recentProjects = useRecentProjects();
  const {
    org,
    organizations,
    isSwitching,
    onSelectOrganization,
  } = useAppSidebarOrganizationSwitching({
    hasSession: !!session,
    config,
    location,
    navigate,
  });

  const isActive = React.useCallback(
    (url: string, end?: boolean) => {
      if (end) return location.pathname === url;
      return location.pathname.startsWith(url);
    },
    [location.pathname],
  );

  const searchParams = React.useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const isOrgTabActive = React.useCallback(
    (tab: OrganizationTab) => {
      if (!isActive(ROUTES.ORG, true)) return false;
      return (searchParams.get("tab") ?? "members") === tab;
    },
    [isActive, searchParams],
  );

  const isSuperAdminTabActive = React.useCallback(
    (tab: SuperAdminTab) => {
      if (!isActive(ROUTES.SUPERADMIN_BASE, true)) return false;
      const section = searchParams.get("section") ?? "instance";
      if (tab === "instance") return section === "instance";
      if (tab === "orgs") return section === "org";
      return section === tab;
    },
    [isActive, searchParams],
  );

  const handleLogout = async () => {
    await authClient.signOut();
    navigate(ROUTES.LOGIN);
  };

  const docsUrl = buildDocsUrl({
    publicDocsBaseUrl: config.publicDocsBaseUrl ?? null,
    currentHost: window.location.host,
    controlPlaneHost: config.controlPlaneHost ?? null,
    pathname: "/",
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {showImmersiveSidebarToggle ? (
          <div className="flex w-full items-center justify-center">
            <SidebarTrigger appearance="brand" className="-mt-0.5 rounded-md" />
          </div>
        ) : (
          <OrganizationSwitcher
            org={org}
            organizations={organizations}
            allowOrganizationChoices={config.capabilities.multiOrg}
            canSelectOrganization={config.canSelectOrganization}
            isSwitching={isSwitching}
            onSelectOrganization={onSelectOrganization}
          />
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <SidebarSearchButton isCollapsed={isCollapsed} onOpenSearch={openSearch} />
          </SidebarGroupContent>
        </SidebarGroup>

        <PlatformNavSection
          docsUrl={docsUrl}
          isCollapsed={isCollapsed}
          showAllProjects={showAllProjects}
          setShowAllProjects={setShowAllProjects}
          recentProjects={recentProjects}
          isActive={isActive}
          locationPathname={location.pathname}
          showOrganizationAdmin={showOrganizationAdmin}
          isOrgOwner={isOrgOwner}
          isOrgTabActive={isOrgTabActive}
          navigate={navigate}
        />

        <SuperAdminNavSection
          showSuperAdmin={showSuperAdmin}
          isSuperAdminTabActive={isSuperAdminTabActive}
          instanceAdminLabel={config.instanceAdminLabel}
          instanceSectionLabel={instanceSectionLabel}
          showPlatformOnlyEntries={showPlatformAdminSections}
        />
      </SidebarContent>

      <SidebarFooter>
        {showSuperAdmin ? <SidebarVersionIndicator software={instanceSoftware} /> : null}
        {session && <UserMenu session={session} onLogout={handleLogout} />}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
