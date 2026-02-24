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
  Plug,
  Server,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { getProjectLastModified } from "@/lib/project-utils";
import { useAppConfig } from "@/lib/AppConfigContext";
import { cn } from "@/lib/utils";
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
  SidebarInput,
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
type SidebarSearchItem = {
  id: string;
  label: string;
  section: "Projects" | "Organization" | "Platform" | "Super Admin";
  to: string;
  keywords: string[];
  isActive: boolean;
};

const ORG_SWITCH_QUERY_KEY = "__vivd_switch_org";
const SIDEBAR_SEARCH_SECTION_ORDER: SidebarSearchItem["section"][] = [
  "Platform",
  "Projects",
  "Organization",
  "Super Admin",
];

function inferSchemeForHost(host: string): "http" | "https" {
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".nip.io")
  ) {
    return "http";
  }
  return "https";
}

function buildTenantStudioUrl(host: string): string {
  return `${inferSchemeForHost(host)}://${host}/vivd-studio`;
}

function inferControlPlaneHostFallback(currentHost: string): string | null {
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

function useRecentProjects(): SidebarProject[] {
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

function normalizeSidebarSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function getSidebarSearchScore(
  item: SidebarSearchItem,
  normalizedQuery: string,
): number | null {
  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (queryTerms.length === 0) return null;

  let totalScore = 0;
  for (const term of queryTerms) {
    let bestTermScore = scoreMatch(item.label, term, 0);
    const sectionScore = scoreMatch(item.section, term, 500);
    if (sectionScore !== null && (bestTermScore === null || sectionScore < bestTermScore)) {
      bestTermScore = sectionScore;
    }

    for (const keyword of item.keywords) {
      const matchIndex = normalizeSidebarSearchValue(keyword).indexOf(term);
      if (matchIndex === -1) continue;
      const score = (matchIndex === 0 ? 200 : 300) + matchIndex;
      if (bestTermScore === null || score < bestTermScore) {
        bestTermScore = score;
      }
    }

    if (bestTermScore === null) {
      return null;
    }
    totalScore += bestTermScore;
  }

  return totalScore;
}

function scoreMatch(value: string, normalizedQuery: string, baseScore: number): number | null {
  const normalizedValue = normalizeSidebarSearchValue(value);
  const matchIndex = normalizedValue.indexOf(normalizedQuery);
  if (matchIndex === -1) return null;
  return baseScore + (matchIndex === 0 ? 0 : 100) + matchIndex;
}

function OrganizationSwitcher({
  org,
  organizations,
  canSelectOrganization,
  onSelectOrganization,
  isSwitching,
}: OrganizationSwitcherProps) {
  const showSwitcher = organizations.length > 1;

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
  isOrgOwner: boolean;
  isCollapsed: boolean;
  isActive: (url: string, end?: boolean) => boolean;
  isOrgTabActive: (tab: "members" | "usage" | "maintenance" | "settings") => boolean;
  navigate: (to: string) => void;
};

function OrganizationNavSection({
  isOrgAdmin,
  isOrgOwner,
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
            {isOrgOwner && (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton asChild isActive={isOrgTabActive("settings")}>
                  <Link to={`${ROUTES.ORG}?tab=settings`}>
                    <SlidersHorizontal className="size-4" />
                    <span>General</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

type SuperAdminNavSectionProps = {
  showSuperAdmin: boolean;
  isSuperAdminTabActive: (
    tab: "orgs" | "users" | "maintenance" | "machines" | "plugins",
  ) => boolean;
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
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Machines"
              isActive={isSuperAdminTabActive("machines")}
            >
              <Link to={`${ROUTES.SUPERADMIN_BASE}?tab=machines`}>
                <Server />
                <span>Machines</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Plugins"
              isActive={isSuperAdminTabActive("plugins")}
            >
              <Link to={`${ROUTES.SUPERADMIN_BASE}?tab=plugins`}>
                <Plug />
                <span>Plugins</span>
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
  const [sidebarSearchQuery, setSidebarSearchQuery] = React.useState("");

  const { data: membership } = trpc.organization.getMyMembership.useQuery(undefined, {
    enabled: !!session && config.hasHostOrganizationAccess,
  });
  const isOrgAdmin = !!membership?.isOrganizationAdmin;
  const isClientEditor = membership?.organizationRole === "client_editor";
  const isOrgOwner =
    membership?.organizationRole === "owner" ||
    session?.user?.role === "super_admin";

  const { data: orgData } = trpc.organization.getMyOrganization.useQuery(undefined, {
    enabled: !!session && config.hasHostOrganizationAccess,
  });
  const org = orgData?.organization ?? null;

  const { data: organizationsData } = trpc.organization.listMyOrganizations.useQuery(
    undefined,
    { enabled: !!session },
  );
  const organizations = organizationsData?.organizations ?? [];

  const setActiveOrganizationMutation = trpc.organization.setActiveOrganization.useMutation();

  const isSuperAdmin = session?.user?.role === "super_admin";
  const showSuperAdmin = isSuperAdmin && !isConfigLoading && config.isSuperAdminHost;

  const recentProjects = useRecentProjects();

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
    (tab: "members" | "usage" | "maintenance" | "settings") => {
      if (!isActive(ROUTES.ORG, true)) return false;
      return (searchParams.get("tab") ?? "members") === tab;
    },
    [isActive, searchParams],
  );

  const isSuperAdminTabActive = React.useCallback(
    (tab: "orgs" | "users" | "maintenance" | "machines" | "plugins") => {
      if (!isActive(ROUTES.SUPERADMIN_BASE, true)) return false;
      return (searchParams.get("tab") ?? "orgs") === tab;
    },
    [isActive, searchParams],
  );

  const sidebarSearchItems = React.useMemo(() => {
    const items: SidebarSearchItem[] = [
      {
        id: "platform:projects",
        label: "Projects",
        section: "Platform",
        to: ROUTES.DASHBOARD,
        keywords: ["dashboard", "websites"],
        isActive:
          isActive(ROUTES.DASHBOARD, true) ||
          isActive(`${ROUTES.STUDIO_BASE}/projects`),
      },
      {
        id: "projects:all",
        label: "All projects",
        section: "Projects",
        to: ROUTES.DASHBOARD,
        keywords: ["all", "dashboard", "overview"],
        isActive: isActive(ROUTES.DASHBOARD, true),
      },
      {
        id: "platform:settings",
        label: "Settings",
        section: "Platform",
        to: ROUTES.SETTINGS,
        keywords: ["account", "profile", "preferences", "password", "security"],
        isActive: isActive(ROUTES.SETTINGS),
      },
    ];

    if (!isClientEditor) {
      items.push({
        id: "platform:new-project",
        label: "New project",
        section: "Platform",
        to: ROUTES.NEW_SCRATCH,
        keywords: ["create", "generate", "scratch", "website"],
        isActive: isActive(ROUTES.NEW_SCRATCH, true),
      });
    }

    for (const project of recentProjects) {
      const projectLabel = project.title || project.slug;
      items.push({
        id: `project:${project.slug}`,
        label: projectLabel,
        section: "Projects",
        to: ROUTES.PROJECT(project.slug),
        keywords: [project.slug, project.title ?? "", "project", "studio", "editor"],
        isActive: isActive(ROUTES.PROJECT(project.slug), true),
      });
      items.push(
        {
          id: `project:plugins:${project.slug}`,
          label: `Plugins: ${projectLabel}`,
          section: "Projects",
          to: ROUTES.PROJECT_PLUGINS(project.slug),
          keywords: [project.slug, projectLabel, "plugins", "integrations", "forms", "analytics"],
          isActive: isActive(ROUTES.PROJECT_PLUGINS(project.slug), true),
        },
        {
          id: `project:analytics:${project.slug}`,
          label: `Analytics: ${projectLabel}`,
          section: "Projects",
          to: ROUTES.PROJECT_ANALYTICS(project.slug),
          keywords: [project.slug, projectLabel, "analytics", "traffic", "metrics"],
          isActive: isActive(ROUTES.PROJECT_ANALYTICS(project.slug), true),
        },
        {
          id: `project:preview:${project.slug}`,
          label: `Preview: ${projectLabel}`,
          section: "Projects",
          to: ROUTES.PROJECT_FULLSCREEN(project.slug),
          keywords: [project.slug, projectLabel, "preview", "fullscreen"],
          isActive: isActive(ROUTES.PROJECT_FULLSCREEN(project.slug), true),
        },
      );
    }

    if (isOrgAdmin) {
      items.push(
        {
          id: "platform:organization",
          label: "Organization",
          section: "Platform",
          to: `${ROUTES.ORG}?tab=members`,
          keywords: ["members", "team", "admin"],
          isActive: isActive(ROUTES.ORG),
        },
        {
          id: "organization:members",
          label: "Members",
          section: "Organization",
          to: `${ROUTES.ORG}?tab=members`,
          keywords: ["team", "users"],
          isActive: isOrgTabActive("members"),
        },
        {
          id: "organization:usage",
          label: "Usage",
          section: "Organization",
          to: `${ROUTES.ORG}?tab=usage`,
          keywords: ["limits", "quota", "credits"],
          isActive: isOrgTabActive("usage"),
        },
        {
          id: "organization:maintenance",
          label: "Maintenance",
          section: "Organization",
          to: `${ROUTES.ORG}?tab=maintenance`,
          keywords: ["operations", "migration"],
          isActive: isOrgTabActive("maintenance"),
        },
      );
      if (isOrgOwner) {
        items.push({
          id: "organization:settings",
          label: "General",
          section: "Organization",
          to: `${ROUTES.ORG}?tab=settings`,
          keywords: ["settings", "owner"],
          isActive: isOrgTabActive("settings"),
        });
      }
    }

    if (showSuperAdmin) {
      items.push(
        {
          id: "platform:superadmin",
          label: "Super Admin",
          section: "Platform",
          to: `${ROUTES.SUPERADMIN_BASE}?tab=orgs`,
          keywords: ["admin", "operators", "system"],
          isActive: isActive(ROUTES.SUPERADMIN_BASE),
        },
        {
          id: "superadmin:orgs",
          label: "Organizations",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?tab=orgs`,
          keywords: ["tenants", "superadmin"],
          isActive: isSuperAdminTabActive("orgs"),
        },
        {
          id: "superadmin:users",
          label: "System Users",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?tab=users`,
          keywords: ["members", "accounts", "superadmin"],
          isActive: isSuperAdminTabActive("users"),
        },
        {
          id: "superadmin:maintenance",
          label: "Maintenance",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?tab=maintenance`,
          keywords: ["operations", "superadmin"],
          isActive: isSuperAdminTabActive("maintenance"),
        },
        {
          id: "superadmin:machines",
          label: "Machines",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?tab=machines`,
          keywords: ["fly", "instances", "superadmin"],
          isActive: isSuperAdminTabActive("machines"),
        },
        {
          id: "superadmin:plugins",
          label: "Plugins",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?tab=plugins`,
          keywords: ["entitlements", "superadmin"],
          isActive: isSuperAdminTabActive("plugins"),
        },
        {
          id: "superadmin:email",
          label: "Email",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?tab=email`,
          keywords: ["deliverability", "suppression", "complaints", "superadmin"],
          isActive:
            isActive(ROUTES.SUPERADMIN_BASE, true) &&
            (searchParams.get("tab") ?? "orgs") === "email",
        },
      );
    }

    return items;
  }, [
    isActive,
    isClientEditor,
    isOrgAdmin,
    isOrgOwner,
    isOrgTabActive,
    isSuperAdminTabActive,
    recentProjects,
    searchParams,
    showSuperAdmin,
  ]);

  const normalizedSidebarSearchQuery = normalizeSidebarSearchValue(sidebarSearchQuery);
  const isSidebarSearchActive = normalizedSidebarSearchQuery.length > 0;

  const sidebarSearchResults = React.useMemo(() => {
    if (!isSidebarSearchActive) return [];

    return sidebarSearchItems
      .map((item) => ({
        item,
        score: getSidebarSearchScore(item, normalizedSidebarSearchQuery),
      }))
      .filter(
        (
          entry,
        ): entry is {
          item: SidebarSearchItem;
          score: number;
        } => entry.score !== null,
      )
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        if (a.item.section !== b.item.section) {
          return a.item.section.localeCompare(b.item.section);
        }
        return a.item.label.localeCompare(b.item.label);
      })
      .map(({ item }) => item);
  }, [
    isSidebarSearchActive,
    normalizedSidebarSearchQuery,
    sidebarSearchItems,
  ]);

  const groupedSidebarSearchResults = React.useMemo(() => {
    if (!isSidebarSearchActive) return [];

    const grouped = new Map<SidebarSearchItem["section"], SidebarSearchItem[]>();
    for (const item of sidebarSearchResults) {
      const existing = grouped.get(item.section) ?? [];
      existing.push(item);
      grouped.set(item.section, existing);
    }

    return SIDEBAR_SEARCH_SECTION_ORDER.flatMap((section) => {
      const items = grouped.get(section) ?? [];
      if (items.length === 0) return [];
      return [{ section, items }];
    });
  }, [isSidebarSearchActive, sidebarSearchResults]);

  React.useEffect(() => {
    if (isCollapsed) {
      setSidebarSearchQuery("");
    }
  }, [isCollapsed]);

  React.useEffect(() => {
    const switchOrg = searchParams.get(ORG_SWITCH_QUERY_KEY);
    if (!switchOrg) return;
    if (!config.canSelectOrganization) return;

    // Clear param early to avoid retry loops on navigation errors.
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete(ORG_SWITCH_QUERY_KEY);
    navigate(
      {
        pathname: location.pathname,
        search: nextParams.toString() ? `?${nextParams.toString()}` : "",
      },
      { replace: true },
    );

    setActiveOrganizationMutation.mutate(
      { organizationId: switchOrg },
      {
        onSuccess: async (result) => {
          await utils.invalidate();
          const tenantHost = result.tenantHost;
          if (tenantHost) {
            window.location.assign(buildTenantStudioUrl(tenantHost));
          } else {
            navigate(ROUTES.DASHBOARD);
          }
        },
        onError: (error) => {
          toast.error("Failed to switch organization", { description: error.message });
        },
      },
    );
  }, [
    config.canSelectOrganization,
    location.pathname,
    location.search,
    navigate,
    searchParams,
    setActiveOrganizationMutation,
    utils,
  ]);

  const handleLogout = async () => {
    await authClient.signOut();
    navigate(ROUTES.LOGIN);
  };

  const handleSelectOrganization = (organizationId: string) => {
    const target = organizations.find((entry) => entry.id === organizationId);
    if (!target) return;

    const redirectToTarget = (tenantHost: string) => {
      console.info(
        `[OrgSwitch] redirecting from ${window.location.host} to ${tenantHost}`,
      );
      window.location.assign(buildTenantStudioUrl(tenantHost));
    };

    if (!config.canSelectOrganization) {
      if (target.tenantHost) {
        redirectToTarget(target.tenantHost);
        return;
      }

      const controlPlaneHost =
        config.controlPlaneHost ?? inferControlPlaneHostFallback(window.location.host);
      if (!controlPlaneHost) {
        toast.error("Control plane host is not configured", {
          description: "Set CONTROL_PLANE_HOST (or open Studio on the control plane domain).",
        });
        return;
      }

      const controlPlaneUrl = new URL(buildTenantStudioUrl(controlPlaneHost));
      controlPlaneUrl.searchParams.set(ORG_SWITCH_QUERY_KEY, target.id);
      console.info(
        `[OrgSwitch] redirecting from ${window.location.host} to control plane ${controlPlaneHost} to switch org`,
      );
      window.location.assign(controlPlaneUrl.toString());
      return;
    }

    setActiveOrganizationMutation.mutate(
      { organizationId },
      {
        onSuccess: async (result) => {
          await utils.invalidate();
          const tenantHost = result.tenantHost ?? target.tenantHost;
          if (tenantHost) {
            redirectToTarget(tenantHost);
          } else {
            navigate(ROUTES.DASHBOARD);
          }
        },
        onError: (error) => {
          toast.error("Failed to switch organization", { description: error.message });
        },
      },
    );
  };

  const handleSidebarSearchResultSelect = (to: string) => {
    setSidebarSearchQuery("");
    navigate(to);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher
          org={org ? { id: org.id, name: org.name, status: org.status } : null}
          organizations={organizations}
          canSelectOrganization={config.canSelectOrganization}
          isSwitching={setActiveOrganizationMutation.isPending}
          onSelectOrganization={handleSelectOrganization}
        />
      </SidebarHeader>

      <SidebarContent>
        {!isCollapsed && (
          <SidebarGroup className="pb-0">
            <SidebarGroupContent>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
                <SidebarInput
                  aria-label="Search"
                  placeholder="Search"
                  value={sidebarSearchQuery}
                  onChange={(event) => setSidebarSearchQuery(event.target.value)}
                  className={cn(
                    "pl-8 border-0 bg-transparent placeholder:text-muted-foreground/70 shadow-none transition-colors",
                    "focus-visible:ring-0 focus-visible:bg-background/90 focus-visible:shadow-[0_0_0_1px_hsl(var(--sidebar-border))]",
                    sidebarSearchQuery.trim()
                      ? "bg-background/85 shadow-[0_0_0_1px_hsl(var(--sidebar-border))]"
                      : "hover:bg-sidebar-accent/30",
                  )}
                />
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {isSidebarSearchActive ? (
          <SidebarGroup>
            <SidebarGroupLabel>
              Search results ({sidebarSearchResults.length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {sidebarSearchResults.length === 0 ? (
                <p className="px-2 py-2 text-sm text-muted-foreground">
                  No sidebar items found.
                </p>
              ) : (
                <div className="space-y-3">
                  {groupedSidebarSearchResults.map((group) => (
                    <div key={group.section}>
                      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                        {group.section}
                      </p>
                      <SidebarMenu>
                        {group.items.map((item) => (
                          <SidebarMenuItem key={item.id}>
                            <SidebarMenuButton
                              isActive={item.isActive}
                              onClick={() => handleSidebarSearchResultSelect(item.to)}
                              className="h-8"
                            >
                              <span className="truncate">{item.label}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </div>
                  ))}
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
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
                    isOrgOwner={isOrgOwner}
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
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        {session && <UserMenu session={session} onLogout={handleLogout} />}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
