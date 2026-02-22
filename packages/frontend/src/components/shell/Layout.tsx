import { Link, Outlet, useLocation } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
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

interface PageInfo {
  title: string;
  isProjectPage: boolean;
  projectSlug?: string;
  isProjectPluginsPage?: boolean;
  isProjectAnalyticsPage?: boolean;
}

function getPageInfo(pathname: string): PageInfo {
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

  // Check for project page: /vivd-studio/projects/:slug
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
  };
}

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
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    );

  return (
    <SidebarProvider>
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
    </SidebarProvider>
  );
}
