import { Link, Outlet, useLocation } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import { Search } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ROUTES } from "@/app/router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ModeToggle } from "@/components/theme";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ProjectWizard } from "@/components/projects";
import { HeaderProfileMenu } from "./HeaderProfileMenu";
import { CenteredLoading } from "@/components/common";
import { NavigationSearchProvider } from "./NavigationSearch";
import {
  NAVIGATION_SEARCH_SHORTCUT_LABEL,
  useNavigationSearch,
} from "./navigationSearchContext";
import { getPageInfo } from "./pageInfo";

export function Layout() {
  const { isPending } = authClient.useSession();
  const location = useLocation();
  const pageInfo = getPageInfo(location.pathname);
  const showNewProjectButton =
    pageInfo.title === "Projects" && !pageInfo.isProjectPage;

  const mainRef = useRef<HTMLElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const mainElement = mainRef.current;
    if (!mainElement || pageInfo.isProjectPage) return;

    const handleScroll = () => {
      setIsScrolled(mainElement.scrollTop > 0);
    };

    mainElement.addEventListener("scroll", handleScroll);
    // Check initial state
    handleScroll();

    return () => mainElement.removeEventListener("scroll", handleScroll);
  }, [pageInfo.isProjectPage]);

  // Reset scroll state when navigating
  useEffect(() => {
    setIsScrolled(false);
  }, [location.pathname]);

  if (isPending)
    return <CenteredLoading fullScreen />;

  return (
    <SidebarProvider>
      <NavigationSearchProvider>
        <AppSidebar />
        <div className="flex flex-1 flex-col min-h-0 h-svh overflow-hidden">
          {/* For project pages, EmbeddedStudioToolbar handles the header */}
          {!pageInfo.isProjectPage && (
            <header
              className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 px-4 bg-background border-b transition-[border-color] duration-150"
              style={{ borderColor: isScrolled ? 'hsl(var(--border))' : 'transparent' }}
            >
              <SidebarTrigger />
              <Separator orientation="vertical" className="h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  {pageInfo.isProjectPluginsPage && pageInfo.projectSlug ? (
                    <>
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <Link to={ROUTES.DASHBOARD}>Projects</Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <Link to={ROUTES.PROJECT(pageInfo.projectSlug)}>
                            {pageInfo.projectSlug}
                          </Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage>Plugins</BreadcrumbPage>
                      </BreadcrumbItem>
                    </>
                  ) : pageInfo.isProjectAnalyticsPage && pageInfo.projectSlug ? (
                    <>
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <Link to={ROUTES.DASHBOARD}>Projects</Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <Link to={ROUTES.PROJECT(pageInfo.projectSlug)}>
                            {pageInfo.projectSlug}
                          </Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage>Analytics</BreadcrumbPage>
                      </BreadcrumbItem>
                    </>
                  ) : (
                    <BreadcrumbItem>
                      <BreadcrumbPage>{pageInfo.title}</BreadcrumbPage>
                    </BreadcrumbItem>
                  )}
                  {showNewProjectButton && (
                    <>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <ProjectWizard onGenerationStarted={() => {}} />
                      </BreadcrumbItem>
                    </>
                  )}
                </BreadcrumbList>
              </Breadcrumb>
              <div className="flex-1" />
              <HeaderSearchTrigger />
              <ModeToggle />
              <HeaderProfileMenu />
            </header>
          )}
          <main
            ref={mainRef}
            className={`flex-1 min-h-0 overflow-auto ${pageInfo.isProjectPage ? "overflow-hidden" : "px-6 py-4"}`}
          >
            <Outlet />
          </main>
        </div>
      </NavigationSearchProvider>
    </SidebarProvider>
  );
}

function HeaderSearchTrigger() {
  const { openSearch } = useNavigationSearch();

  return (
    <button
      type="button"
      aria-label="Open search"
      onClick={openSearch}
      className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/20 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Search className="size-4" />
      <span className="hidden sm:inline">Search</span>
      <span className="hidden text-xs font-medium text-muted-foreground/80 md:inline">
        {NAVIGATION_SEARCH_SHORTCUT_LABEL}
      </span>
    </button>
  );
}
