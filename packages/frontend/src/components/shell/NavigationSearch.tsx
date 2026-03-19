import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";

import { ROUTES } from "@/app/router";
import { useAppConfig } from "@/lib/AppConfigContext";
import { authClient } from "@/lib/auth-client";
import { getProjectLastModified } from "@/lib/project-utils";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  NavigationSearchContext,
  type NavigationSearchContextValue,
} from "./navigationSearchContext";

type NavigationSearchProject = RouterOutputs["project"]["list"]["projects"][number];
type NavigationSearchItem = {
  id: string;
  label: string;
  section: "Projects" | "Organization" | "Platform" | "Super Admin";
  to: string;
  keywords: string[];
  isActive: boolean;
};

type GroupedSearchResults = {
  section: NavigationSearchItem["section"];
  items: Array<{
    item: NavigationSearchItem;
    index: number;
  }>;
};

const NAVIGATION_SEARCH_SECTION_ORDER: NavigationSearchItem["section"][] = [
  "Platform",
  "Projects",
  "Organization",
  "Super Admin",
];

function useRecentProjects(): NavigationSearchProject[] {
  const { data: projectsData } = trpc.project.list.useQuery(undefined, {
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

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function scoreMatch(value: string, normalizedQuery: string, baseScore: number): number | null {
  const normalizedValue = normalizeSearchValue(value);
  const matchIndex = normalizedValue.indexOf(normalizedQuery);
  if (matchIndex === -1) return null;
  return baseScore + (matchIndex === 0 ? 0 : 100) + matchIndex;
}

function getSearchScore(
  item: NavigationSearchItem,
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
      const matchIndex = normalizeSearchValue(keyword).indexOf(term);
      if (matchIndex === -1) continue;
      const score = (matchIndex === 0 ? 200 : 300) + matchIndex;
      if (bestTermScore === null || score < bestTermScore) {
        bestTermScore = score;
      }
    }

    if (bestTermScore === null) return null;
    totalScore += bestTermScore;
  }

  return totalScore;
}

function buildGroupedSearchResults(results: NavigationSearchItem[]): GroupedSearchResults[] {
  const grouped = new Map<NavigationSearchItem["section"], NavigationSearchItem[]>();
  for (const item of results) {
    const existing = grouped.get(item.section) ?? [];
    existing.push(item);
    grouped.set(item.section, existing);
  }

  let index = 0;
  return NAVIGATION_SEARCH_SECTION_ORDER.flatMap((section) => {
    const items = grouped.get(section) ?? [];
    if (items.length === 0) return [];

    const indexedItems = items.map((item) => {
      const entry = { item, index };
      index += 1;
      return entry;
    });

    return [{ section, items: indexedItems }];
  });
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function useNavigationSearchItems(): NavigationSearchItem[] {
  const { data: session } = authClient.useSession();
  const { config, isLoading: isConfigLoading } = useAppConfig();
  const location = useLocation();
  const recentProjects = useRecentProjects();

  const { data: membership } = trpc.organization.getMyMembership.useQuery(undefined, {
    enabled: !!session && config.hasHostOrganizationAccess,
  });
  const isOrgAdmin = !!membership?.isOrganizationAdmin;
  const isClientEditor = membership?.organizationRole === "client_editor";
  const isOrgOwner =
    membership?.organizationRole === "owner" ||
    session?.user?.role === "super_admin";
  const isSuperAdmin = session?.user?.role === "super_admin";
  const showSuperAdmin = isSuperAdmin && !isConfigLoading && config.isSuperAdminHost;

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
    (tab: "members" | "usage" | "maintenance" | "plugins" | "settings") => {
      if (!isActive(ROUTES.ORG, true)) return false;
      return (searchParams.get("tab") ?? "members") === tab;
    },
    [isActive, searchParams],
  );

  const isSuperAdminTabActive = React.useCallback(
    (
      tab: "instance" | "orgs" | "users" | "maintenance" | "machines" | "plugins",
    ) => {
      if (!isActive(ROUTES.SUPERADMIN_BASE, true)) return false;
      const section = searchParams.get("section") ?? "instance";
      if (tab === "instance") return section === "instance";
      if (tab === "orgs") return section === "org";
      return section === tab;
    },
    [isActive, searchParams],
  );

  return React.useMemo(() => {
    const items: NavigationSearchItem[] = [
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

    if (isOrgAdmin && config.capabilities.multiOrg) {
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
        {
          id: "organization:plugins",
          label: "Plugins",
          section: "Organization",
          to: `${ROUTES.ORG}?tab=plugins`,
          keywords: ["integrations", "contact form", "analytics"],
          isActive: isOrgTabActive("plugins"),
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
          label: config.instanceAdminLabel,
          section: "Platform",
          to: `${ROUTES.SUPERADMIN_BASE}?section=instance`,
          keywords: ["admin", "operators", "system"],
          isActive: isActive(ROUTES.SUPERADMIN_BASE),
        },
        {
          id: "superadmin:instance",
          label: config.instanceAdminLabel === "Instance Settings" ? "General" : "Instance",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?section=instance`,
          keywords: ["instance", "profile", "capabilities", "limits"],
          isActive: isSuperAdminTabActive("instance"),
        },
      );

      if (config.installProfile === "platform") {
        items.push(
          {
            id: "superadmin:orgs",
            label: "Organizations",
            section: "Super Admin",
            to: `${ROUTES.SUPERADMIN_BASE}?section=org`,
            keywords: ["tenants", "superadmin"],
            isActive: isSuperAdminTabActive("orgs"),
          },
          {
            id: "superadmin:users",
            label: "System Users",
            section: "Super Admin",
            to: `${ROUTES.SUPERADMIN_BASE}?section=users`,
            keywords: ["members", "accounts", "superadmin"],
            isActive: isSuperAdminTabActive("users"),
          },
          {
            id: "superadmin:maintenance",
            label: "Maintenance",
            section: "Super Admin",
            to: `${ROUTES.SUPERADMIN_BASE}?section=maintenance`,
            keywords: ["operations", "superadmin"],
            isActive: isSuperAdminTabActive("maintenance"),
          },
          {
            id: "superadmin:plugins",
            label: "Plugins",
            section: "Super Admin",
            to: `${ROUTES.SUPERADMIN_BASE}?section=plugins`,
            keywords: ["entitlements", "superadmin"],
            isActive: isSuperAdminTabActive("plugins"),
          },
        );
      } else {
        items.push({
          id: "superadmin:plugins",
          label: "Plugins",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?section=plugins`,
          keywords: ["plugins", "instance", "contact form", "analytics"],
          isActive: isSuperAdminTabActive("plugins"),
        });
      }

      items.push(
        {
          id: "superadmin:email",
          label: "Email",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?section=email`,
          keywords: ["deliverability", "suppression", "complaints", "superadmin"],
          isActive:
            isActive(ROUTES.SUPERADMIN_BASE, true) &&
            (searchParams.get("section") ?? "instance") === "email",
        },
        {
          id: "superadmin:machines",
          label: "Machines",
          section: "Super Admin",
          to: `${ROUTES.SUPERADMIN_BASE}?section=machines`,
          keywords: ["runtime", "instances", "studio"],
          isActive: isSuperAdminTabActive("machines"),
        },
      );
    }

    return items;
  }, [
    isActive,
    isClientEditor,
    config.capabilities.multiOrg,
    config.installProfile,
    config.instanceAdminLabel,
    isOrgAdmin,
    isOrgOwner,
    isOrgTabActive,
    isSuperAdminTabActive,
    recentProjects,
    searchParams,
    showSuperAdmin,
  ]);
}

function NavigationSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const resultsViewportRef = React.useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const searchItems = useNavigationSearchItems();
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(-1);

  const normalizedQuery = normalizeSearchValue(query);
  const isSearchActive = normalizedQuery.length > 0;

  const searchResults = React.useMemo(() => {
    if (!isSearchActive) return [];

    return searchItems
      .map((item) => ({
        item,
        score: getSearchScore(item, normalizedQuery),
      }))
      .filter(
        (
          entry,
        ): entry is {
          item: NavigationSearchItem;
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
  }, [isSearchActive, normalizedQuery, searchItems]);

  const groupedSearchResults = React.useMemo(
    () => buildGroupedSearchResults(searchResults),
    [searchResults],
  );

  const handleSelectResult = React.useCallback(
    (to: string) => {
      onOpenChange(false);
      navigate(to);
    },
    [navigate, onOpenChange],
  );

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(-1);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    setSelectedIndex(searchResults.length > 0 ? 0 : -1);
  }, [open, searchResults.length]);

  React.useEffect(() => {
    if (!open || selectedIndex < 0) return;

    const selectedResult = resultsViewportRef.current?.querySelector<HTMLElement>(
      `[data-search-index="${selectedIndex}"]`,
    );
    selectedResult?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchResults.length === 0) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) =>
        current >= searchResults.length - 1 ? 0 : current + 1,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        current <= 0 ? searchResults.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Enter" && selectedIndex >= 0) {
      event.preventDefault();
      const selectedResult = searchResults[selectedIndex];
      if (selectedResult) handleSelectResult(selectedResult.to);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden p-0",
          isMobile
            ? "left-0 top-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0"
            : "top-[14vh] max-w-2xl translate-y-0",
        )}
      >
        <DialogTitle className="sr-only">Search navigation</DialogTitle>
        <DialogDescription className="sr-only">
          Search across projects, organization pages, settings, and admin routes.
        </DialogDescription>

        <div className="border-b border-border p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              aria-label="Search"
              autoComplete="off"
              placeholder="Search projects, settings, plugins..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              className="h-11 border-0 bg-transparent pl-10 pr-4 text-base shadow-none focus-visible:ring-0"
            />
          </div>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            Enter to open, use arrow keys to move, and press Esc to close.
          </p>
        </div>

        <div
          ref={resultsViewportRef}
          className="max-h-[min(65dvh,36rem)] overflow-y-auto p-2 sm:p-3"
        >
          {!isSearchActive ? (
            <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center text-sm text-muted-foreground">
              Start typing to jump to projects, settings, plugins, and admin pages.
            </div>
          ) : searchResults.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center text-sm text-muted-foreground">
              No results found for “{query.trim()}”.
            </div>
          ) : (
            <div className="space-y-4">
              <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Search results ({searchResults.length})
              </p>
              {groupedSearchResults.map((group) => (
                <div key={group.section} className="space-y-1">
                  <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                    {group.section}
                  </p>
                  <div className="space-y-1">
                    {group.items.map(({ item, index }) => {
                      const isSelected = selectedIndex === index;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-label={item.label}
                          data-selected={isSelected ? "true" : "false"}
                          data-search-index={index}
                          onClick={() => handleSelectResult(item.to)}
                          onMouseMove={() => {
                            if (!isSelected) {
                              setSelectedIndex(index);
                            }
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                            isSelected
                              ? "bg-accent text-accent-foreground"
                              : "bg-transparent",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.label}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {item.section}
                            </p>
                          </div>
                          {item.isActive ? (
                            <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Current
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NavigationSearchProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const location = useLocation();
  const [isOpen, setIsOpen] = React.useState(false);

  const openSearch = React.useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeSearch = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) {
        return;
      }
      if (isEditableElement(event.target)) return;

      event.preventDefault();
      setIsOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  React.useEffect(() => {
    setIsOpen(false);
  }, [location.pathname, location.search]);

  const value = React.useMemo<NavigationSearchContextValue>(
    () => ({
      isOpen,
      openSearch,
      closeSearch,
    }),
    [closeSearch, isOpen, openSearch],
  );

  return (
    <NavigationSearchContext.Provider value={value}>
      {children}
      <NavigationSearchDialog open={isOpen} onOpenChange={setIsOpen} />
    </NavigationSearchContext.Provider>
  );
}
