import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  LayoutGrid,
  Mail,
  Plug,
  Search,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
  Wrench,
} from "lucide-react";
import { ROUTES } from "@/app/router";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@vivd/ui";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { NAVIGATION_SEARCH_SHORTCUT_LABEL } from "../navigationSearchContext";
import {
  type OrganizationTab,
  type SidebarProject,
  type SuperAdminTab,
} from "./helpers";

type RouteMatcher = (url: string, end?: boolean) => boolean;

export function SidebarSearchButton({
  isCollapsed,
  onOpenSearch,
}: {
  isCollapsed: boolean;
  onOpenSearch: () => void;
}) {
  return isCollapsed ? (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          tooltip="Search"
          aria-label="Open search"
          onClick={onOpenSearch}
        >
          <Search />
          <span>Search</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  ) : (
    <button
      type="button"
      aria-label="Open search"
      onClick={onOpenSearch}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors",
        "bg-transparent text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground",
        "focus-visible:outline-none focus-visible:bg-background/90 focus-visible:text-foreground focus-visible:shadow-[0_0_0_1px_hsl(var(--primary))]",
      )}
    >
      <Search className="size-4 text-muted-foreground/80" />
      <span>Search</span>
      <span className="ml-auto text-[11px] font-medium text-muted-foreground/70">
        {NAVIGATION_SEARCH_SHORTCUT_LABEL}
      </span>
    </button>
  );
}

type ProjectsNavSectionProps = {
  isCollapsed: boolean;
  showAllProjects: boolean;
  setShowAllProjects: Dispatch<SetStateAction<boolean>>;
  recentProjects: SidebarProject[];
  isActive: RouteMatcher;
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
            onClick={(event) => {
              if (isCollapsed) {
                event.preventDefault();
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

            {recentProjects.length > 5 ? (
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
            ) : null}
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
  isActive: RouteMatcher;
  isOrgTabActive: (tab: OrganizationTab) => boolean;
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
            onClick={(event) => {
              if (isCollapsed) {
                event.preventDefault();
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
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild isActive={isOrgTabActive("plugins")}>
                <Link to={`${ROUTES.ORG}?tab=plugins`}>
                  <Plug className="size-4" />
                  <span>Plugins</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            {isOrgOwner ? (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton asChild isActive={isOrgTabActive("settings")}>
                  <Link to={`${ROUTES.ORG}?tab=settings`}>
                    <SlidersHorizontal className="size-4" />
                    <span>General</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ) : null}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

type PlatformNavSectionProps = {
  docsUrl: string;
  isCollapsed: boolean;
  showAllProjects: boolean;
  setShowAllProjects: Dispatch<SetStateAction<boolean>>;
  recentProjects: SidebarProject[];
  isActive: RouteMatcher;
  locationPathname: string;
  showOrganizationAdmin: boolean;
  isOrgOwner: boolean;
  isOrgTabActive: (tab: OrganizationTab) => boolean;
  navigate: (to: string) => void;
};

export function PlatformNavSection({
  docsUrl,
  isCollapsed,
  showAllProjects,
  setShowAllProjects,
  recentProjects,
  isActive,
  locationPathname,
  showOrganizationAdmin,
  isOrgOwner,
  isOrgTabActive,
  navigate,
}: PlatformNavSectionProps) {
  return (
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
            locationPathname={locationPathname}
            navigate={navigate}
          />

          <OrganizationNavSection
            isOrgAdmin={showOrganizationAdmin}
            isOrgOwner={isOrgOwner}
            isCollapsed={isCollapsed}
            isActive={isActive}
            isOrgTabActive={isOrgTabActive}
            navigate={navigate}
          />

          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Docs">
              <a href={docsUrl} target="_blank" rel="noreferrer">
                <BookOpen />
                <span>Docs</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>

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
  );
}

type SuperAdminNavSectionProps = {
  showSuperAdmin: boolean;
  isSuperAdminTabActive: (tab: SuperAdminTab) => boolean;
  instanceAdminLabel: string;
  instanceSectionLabel: string;
  showPlatformOnlyEntries: boolean;
};

export function SuperAdminNavSection({
  showSuperAdmin,
  isSuperAdminTabActive,
  instanceAdminLabel,
  instanceSectionLabel,
  showPlatformOnlyEntries,
}: SuperAdminNavSectionProps) {
  if (!showSuperAdmin) return null;

  return (
    <SidebarGroup className="mt-auto border-t border-dashed border-sidebar-border pt-2 opacity-70 transition-opacity hover:opacity-100">
      <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
        <Shield className="mr-1 size-3" />
        {instanceAdminLabel}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={instanceAdminLabel}
              isActive={isSuperAdminTabActive("instance")}
            >
              <Link to={`${ROUTES.SUPERADMIN_BASE}?section=instance`}>
                <Shield />
                <span>{instanceSectionLabel}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {showPlatformOnlyEntries ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Organizations"
                isActive={isSuperAdminTabActive("orgs")}
              >
                <Link to={`${ROUTES.SUPERADMIN_BASE}?section=org`}>
                  <Building2 />
                  <span>Organizations</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {showPlatformOnlyEntries ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="System Users"
                isActive={isSuperAdminTabActive("users")}
              >
                <Link to={`${ROUTES.SUPERADMIN_BASE}?section=users`}>
                  <Users />
                  <span>System Users</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {showPlatformOnlyEntries ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Maintenance"
                isActive={isSuperAdminTabActive("maintenance")}
              >
                <Link to={`${ROUTES.SUPERADMIN_BASE}?section=maintenance`}>
                  <Wrench />
                  <span>Maintenance</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Machines"
              isActive={isSuperAdminTabActive("machines")}
            >
              <Link to={`${ROUTES.SUPERADMIN_BASE}?section=machines`}>
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
              <Link to={`${ROUTES.SUPERADMIN_BASE}?section=plugins`}>
                <Plug />
                <span>Plugins</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Email"
              isActive={isSuperAdminTabActive("email")}
            >
              <Link to={`${ROUTES.SUPERADMIN_BASE}?section=email`}>
                <Mail />
                <span>Email</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
