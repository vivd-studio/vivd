import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FolderKanban,
  LayoutGrid,
  LogOut,
  Settings,
  Shield,
  Users,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { getProjectLastModified } from "@/lib/project-utils";
import { useAppConfig } from "@/lib/AppConfigContext";
import { ROUTES } from "@/app/router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

type SidebarProject = RouterOutputs["project"]["list"]["projects"][number];
type SwitcherOrganization =
  RouterOutputs["organization"]["listMyOrganizations"]["organizations"][number];

function useRecentProjects(): SidebarProject[] {
  const { data: projectsData } = trpc.project.list.useQuery(undefined, {
    // Keep data fresh for cross-tab/background updates without a heavy 5s loop.
    refetchInterval: 30_000,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  return React.useMemo(() => {
    if (!projectsData?.projects) return [];
    return [...projectsData.projects].sort(
      (a, b) => getProjectLastModified(b) - getProjectLastModified(a),
    );
  }, [projectsData?.projects]);
}

type OrganizationSwitcherProps = {
  org: {
    id: string;
    name: string;
    status: string;
  } | null;
  organizations: SwitcherOrganization[];
  canSelectOrganization: boolean;
  onSelectOrganization: (organizationId: string) => void;
  isSwitching: boolean;
};

function formatOrgRole(role: string): string {
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

function OrganizationSwitcher({
  org,
  organizations,
  canSelectOrganization,
  onSelectOrganization,
  isSwitching,
}: OrganizationSwitcherProps) {
  const showSwitcher = canSelectOrganization && organizations.length > 1;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-amber-500 text-white font-bold">
                v
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  vi
                  <span
                    style={{
                      background: "linear-gradient(135deg, #10B981 0%, #F59E0B 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    vd
                  </span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {org?.name ?? "Studio"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side="bottom"
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Building2 className="size-4 text-muted-foreground" />
                <span className="truncate font-medium">{org?.name ?? "Organization"}</span>
                {org && (
                  <Badge
                    variant={org.status === "active" ? "default" : "secondary"}
                    className="ml-auto text-[10px] px-1.5 py-0"
                  >
                    {org.status}
                  </Badge>
                )}
              </div>
            </DropdownMenuLabel>
            {(showSwitcher || !canSelectOrganization) && <DropdownMenuSeparator />}
            {showSwitcher ? (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Switch organization
                </DropdownMenuLabel>
                {organizations.map((entry) => (
                  <DropdownMenuItem
                    key={entry.id}
                    disabled={isSwitching || entry.isActive}
                    onSelect={() => onSelectOrganization(entry.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      {entry.isActive ? (
                        <Check className="size-4 shrink-0" />
                      ) : (
                        <span className="size-4 shrink-0" />
                      )}
                      <span className="truncate">{entry.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground shrink-0">
                        {formatOrgRole(entry.role)}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </>
            ) : !canSelectOrganization ? (
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                Organization pinned to this domain
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

type ProjectsNavSectionProps = {
  isCollapsed: boolean;
  showAllProjects: boolean;
  setShowAllProjects: React.Dispatch<React.SetStateAction<boolean>>;
  recentProjects: SidebarProject[];
  isActive: (url: string, end?: boolean) => boolean;
  locationPathname: string;
  navigate: (to: string) => void;
};

function ProjectsNavSection({
  isCollapsed,
  showAllProjects,
  setShowAllProjects,
  recentProjects,
  isActive,
  locationPathname,
  navigate,
}: ProjectsNavSectionProps) {
  const isProjectsActive =
    isActive(ROUTES.DASHBOARD, true) ||
    isActive(`${ROUTES.STUDIO_BASE}/projects`);

  return (
    <Collapsible
      asChild
      defaultOpen={isProjectsActive}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip="Projects"
            isActive={isProjectsActive}
            onClick={(e) => {
              if (isCollapsed) {
                e.preventDefault();
                navigate(ROUTES.DASHBOARD);
              }
            }}
          >
            <FolderKanban />
            <span>Projects</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild isActive={isActive(ROUTES.DASHBOARD, true)}>
                <Link to={ROUTES.DASHBOARD}>
                  <LayoutGrid className="size-4" />
                  <span className="font-medium">All</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>

            {(showAllProjects ? recentProjects : recentProjects.slice(0, 5)).map((project) => (
              <SidebarMenuSubItem key={project.slug}>
                <SidebarMenuSubButton
                  asChild
                  isActive={locationPathname === ROUTES.PROJECT(project.slug)}
                >
                  <Link to={ROUTES.PROJECT(project.slug)}>
                    <span className="truncate">{project.title || project.slug}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}

            {recentProjects.length > 5 && (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton
                  onClick={() => setShowAllProjects(!showAllProjects)}
                  className="cursor-pointer"
                >
                  <ChevronDown
                    className={`size-4 transition-transform duration-200 ${showAllProjects ? "rotate-180" : ""}`}
                  />
                  <span className="text-muted-foreground">
                    {showAllProjects ? "Show less" : "Show more"}
                  </span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

type OrganizationNavSectionProps = {
  isOrgAdmin: boolean;
  isCollapsed: boolean;
  isActive: (url: string, end?: boolean) => boolean;
  isOrgTabActive: (tab: "members" | "usage" | "maintenance") => boolean;
  navigate: (to: string) => void;
};

function OrganizationNavSection({
  isOrgAdmin,
  isCollapsed,
  isActive,
  isOrgTabActive,
  navigate,
}: OrganizationNavSectionProps) {
  if (!isOrgAdmin) return null;

  return (
    <Collapsible
      asChild
      defaultOpen={isActive(ROUTES.ORG)}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip="Organization"
            isActive={isActive(ROUTES.ORG)}
            onClick={(e) => {
              if (isCollapsed) {
                e.preventDefault();
                navigate(`${ROUTES.ORG}?tab=members`);
              }
            }}
          >
            <Building2 />
            <span>Organization</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild isActive={isOrgTabActive("members")}>
                <Link to={`${ROUTES.ORG}?tab=members`}>
                  <Users className="size-4" />
                  <span>Members</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild isActive={isOrgTabActive("usage")}>
                <Link to={`${ROUTES.ORG}?tab=usage`}>
                  <Activity className="size-4" />
                  <span>Usage</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild isActive={isOrgTabActive("maintenance")}>
                <Link to={`${ROUTES.ORG}?tab=maintenance`}>
                  <Wrench className="size-4" />
                  <span>Maintenance</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

type SuperAdminNavSectionProps = {
  showSuperAdmin: boolean;
  isSuperAdminTabActive: (tab: "orgs" | "users" | "maintenance") => boolean;
};

function SuperAdminNavSection({
  showSuperAdmin,
  isSuperAdminTabActive,
}: SuperAdminNavSectionProps) {
  if (!showSuperAdmin) return null;

  return (
    <SidebarGroup className="mt-auto border-t border-dashed border-sidebar-border pt-2 opacity-70 hover:opacity-100 transition-opacity">
      <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
        <Shield className="size-3 mr-1" />
        Super Admin
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Organizations"
              isActive={isSuperAdminTabActive("orgs")}
            >
              <Link to={`${ROUTES.SUPERADMIN_BASE}?tab=orgs`}>
                <Building2 />
                <span>Organizations</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="System Users"
              isActive={isSuperAdminTabActive("users")}
            >
              <Link to={`${ROUTES.SUPERADMIN_BASE}?tab=users`}>
                <Users />
                <span>System Users</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Maintenance"
              isActive={isSuperAdminTabActive("maintenance")}
            >
              <Link to={`${ROUTES.SUPERADMIN_BASE}?tab=maintenance`}>
                <Wrench />
                <span>Maintenance</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

type UserMenuProps = {
  session: NonNullable<ReturnType<typeof authClient.useSession>["data"]>;
  onLogout: () => Promise<void>;
};

function UserMenu({ session, onLogout }: UserMenuProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage
                  src={session.user.image || undefined}
                  alt={session.user.name}
                />
                <AvatarFallback className="rounded-lg">
                  {session.user.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{session.user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {session.user.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={session.user.image || undefined}
                    alt={session.user.name}
                  />
                  <AvatarFallback className="rounded-lg">
                    {session.user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{session.user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {session.user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void onLogout()}>
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const { data: session } = authClient.useSession();
  const utils = trpc.useUtils();
  const { config, isLoading: isConfigLoading } = useAppConfig();
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useSidebar();

  const isCollapsed = state === "collapsed";
  const [showAllProjects, setShowAllProjects] = React.useState(false);

  const { data: membership } = trpc.organization.getMyMembership.useQuery(undefined, {
    enabled: !!session,
  });
  const isOrgAdmin = !!membership?.isOrganizationAdmin;

  const { data: orgData } = trpc.organization.getMyOrganization.useQuery(undefined, {
    enabled: !!session,
  });
  const org = orgData?.organization ?? null;

  const { data: organizationsData } = trpc.organization.listMyOrganizations.useQuery(
    undefined,
    { enabled: !!session },
  );
  const organizations = organizationsData?.organizations ?? [];

  const setActiveOrganizationMutation = trpc.organization.setActiveOrganization.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      navigate(ROUTES.DASHBOARD);
    },
    onError: (error) => {
      toast.error("Failed to switch organization", { description: error.message });
    },
  });

  const isSuperAdmin = session?.user?.role === "super_admin";
  const showSuperAdmin = isSuperAdmin && !isConfigLoading && config.isSuperAdminHost;

  const recentProjects = useRecentProjects();

  const isActive = (url: string, end?: boolean) => {
    if (end) return location.pathname === url;
    return location.pathname.startsWith(url);
  };

  const searchParams = React.useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const isOrgTabActive = (tab: "members" | "usage" | "maintenance") => {
    if (!isActive(ROUTES.ORG, true)) return false;
    return (searchParams.get("tab") ?? "members") === tab;
  };

  const isSuperAdminTabActive = (tab: "orgs" | "users" | "maintenance") => {
    if (!isActive(ROUTES.SUPERADMIN_BASE, true)) return false;
    return (searchParams.get("tab") ?? "orgs") === tab;
  };

  const handleLogout = async () => {
    await authClient.signOut();
    navigate(ROUTES.LOGIN);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher
          org={org ? { id: org.id, name: org.name, status: org.status } : null}
          organizations={organizations}
          canSelectOrganization={config.canSelectOrganization}
          isSwitching={setActiveOrganizationMutation.isPending}
          onSelectOrganization={(organizationId) =>
            setActiveOrganizationMutation.mutate({ organizationId })
          }
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <ProjectsNavSection
                isCollapsed={isCollapsed}
                showAllProjects={showAllProjects}
                setShowAllProjects={setShowAllProjects}
                recentProjects={recentProjects}
                isActive={isActive}
                locationPathname={location.pathname}
                navigate={navigate}
              />

              <OrganizationNavSection
                isOrgAdmin={isOrgAdmin}
                isCollapsed={isCollapsed}
                isActive={isActive}
                isOrgTabActive={isOrgTabActive}
                navigate={navigate}
              />

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(ROUTES.SETTINGS)}
                  tooltip="Settings"
                >
                  <Link to={ROUTES.SETTINGS}>
                    <Settings />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SuperAdminNavSection
          showSuperAdmin={showSuperAdmin}
          isSuperAdminTabActive={isSuperAdminTabActive}
        />
      </SidebarContent>

      <SidebarFooter>
        {session && <UserMenu session={session} onLogout={handleLogout} />}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
