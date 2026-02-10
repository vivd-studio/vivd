import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { getProjectLastModified } from "@/lib/project-utils";
import { ROUTES } from "@/app/router";
import {
  FolderKanban,
  Shield,
  Settings,
  LogOut,
  ChevronsUpDown,
  ChevronRight,
  ChevronDown,
  Users,
  Activity,
  Wrench,
  LayoutGrid,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function AppSidebar() {
  const { data: session } = authClient.useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useSidebar();
  const isAdmin = session?.user?.role === "super_admin";
  const isCollapsed = state === "collapsed";
  const [showAllProjects, setShowAllProjects] = React.useState(false);

  // Fetch projects for the collapsible sidebar list
  const { data: projectsData } = trpc.project.list.useQuery(undefined, {
    refetchInterval: 5000, // Poll every 5 seconds
  });

  // Sort projects by most recently updated (updatedAt first, then fallback to latest version's createdAt)
  const recentProjects = React.useMemo(() => {
    if (!projectsData?.projects) return [];

    return [...projectsData.projects].sort(
      (a, b) => getProjectLastModified(b) - getProjectLastModified(a),
    );
  }, [projectsData?.projects]);

  const handleLogout = async () => {
    await authClient.signOut();
    navigate(ROUTES.LOGIN);
  };

  const isActive = (url: string, end?: boolean) => {
    if (end) {
      return location.pathname === url;
    }
    return location.pathname.startsWith(url);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Link to={ROUTES.DASHBOARD}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-amber-500 text-white font-bold">
                  v
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    vi
                    <span
                      style={{
                        background:
                          "linear-gradient(135deg, #10B981 0%, #F59E0B 100%)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        backgroundClip: "text",
                      }}
                    >
                      vd
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    Studio
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Projects - collapsible with recent projects */}
              <Collapsible
                asChild
                defaultOpen={
                  isActive(ROUTES.DASHBOARD, true) ||
                  isActive(`${ROUTES.STUDIO_BASE}/projects`)
                }
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip="Projects"
                      isActive={
                        isActive(ROUTES.DASHBOARD, true) ||
                        isActive(`${ROUTES.STUDIO_BASE}/projects`)
                      }
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
                      {/* All Projects - first item with icon */}
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={isActive(ROUTES.DASHBOARD, true)}
                        >
                          <Link to={ROUTES.DASHBOARD}>
                            <LayoutGrid className="size-4" />
                            <span className="font-medium">All</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      {(showAllProjects
                        ? recentProjects
                        : recentProjects.slice(0, 5)
                      ).map((project) => (
                        <SidebarMenuSubItem key={project.slug}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={
                              location.pathname === ROUTES.PROJECT(project.slug)
                            }
                          >
                            <Link to={ROUTES.PROJECT(project.slug)}>
                              <span className="truncate">
                                {project.title || project.slug}
                              </span>
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

              {/* Admin - collapsible with sub-items */}
              {isAdmin && (
                <Collapsible
                  asChild
                  defaultOpen={isActive(ROUTES.ADMIN)}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip="Admin"
                        isActive={isActive(ROUTES.ADMIN)}
                        onClick={(e) => {
                          if (isCollapsed) {
                            e.preventDefault();
                            navigate(`${ROUTES.ADMIN}?tab=users`);
                          }
                        }}
                      >
                        <Shield />
                        <span>Admin</span>
                        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={location.search.includes("tab=orgs")}
                          >
                            <Link to={`${ROUTES.ADMIN}?tab=orgs`}>
                              <Shield className="size-4" />
                              <span>Orgs</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={
                              isActive(ROUTES.ADMIN) &&
                              (location.search === "" ||
                                location.search.includes("tab=users"))
                            }
                          >
                            <Link to={`${ROUTES.ADMIN}?tab=users`}>
                              <Users className="size-4" />
                              <span>Users</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={location.search.includes("tab=usage")}
                          >
                            <Link to={`${ROUTES.ADMIN}?tab=usage`}>
                              <Activity className="size-4" />
                              <span>Usage</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={location.search.includes(
                              "tab=maintenance",
                            )}
                          >
                            <Link to={`${ROUTES.ADMIN}?tab=maintenance`}>
                              <Wrench className="size-4" />
                              <span>Maintenance</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )}

              {/* Settings - collapsible */}
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
      </SidebarContent>

      <SidebarFooter>
        {session && (
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
                      <span className="truncate font-semibold">
                        {session.user.name}
                      </span>
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
                        <span className="truncate font-semibold">
                          {session.user.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {session.user.email}
                        </span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
