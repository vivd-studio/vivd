import { Outlet, useLocation } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { ROUTES } from "@/app/router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@vivd/ui";

import { ProjectWizard } from "@/components/projects";
import { CenteredLoading } from "@/components/common";
import { NavigationSearchProvider } from "./NavigationSearch";
import { HeaderBreadcrumbTextLink, HostHeader } from "./HostHeader";
import { getPageInfo } from "./pageInfo";
import { useAppConfig } from "@/lib/AppConfigContext";

export function Layout() {
  const { isPending } = authClient.useSession();
  const { config } = useAppConfig();
  const location = useLocation();
  const pageInfo = getPageInfo(location.pathname);
  const pageTitle = location.pathname.startsWith("/vivd-studio/superadmin")
    ? config.instanceAdminLabel
    : pageInfo.title;
  const isEmbeddedProjectPanel =
    new URLSearchParams(location.search).get("embedded") === "1" &&
    (pageInfo.isProjectPluginsPage || pageInfo.isProjectPluginPage);
  const showNewProjectButton =
    pageTitle === "Projects" && !pageInfo.isProjectPage;

  const mainRef = useRef<HTMLElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const mainElement = mainRef.current;
    if (!mainElement || pageInfo.isProjectPage || isEmbeddedProjectPanel) return;

    const handleScroll = () => {
      setIsScrolled(mainElement.scrollTop > 0);
    };

    mainElement.addEventListener("scroll", handleScroll);
    // Check initial state
    handleScroll();

    return () => mainElement.removeEventListener("scroll", handleScroll);
  }, [isEmbeddedProjectPanel, pageInfo.isProjectPage]);

  // Reset scroll state when navigating
  useEffect(() => {
    setIsScrolled(false);
  }, [location.pathname, location.search]);

  if (isPending)
    return <CenteredLoading fullScreen />;

  return (
    <SidebarProvider
      desktopMode={pageInfo.usesImmersiveSidebar ? "immersive" : "default"}
      immersiveKey={
        pageInfo.usesImmersiveSidebar
          ? pageInfo.projectSlug ?? location.pathname
          : undefined
      }
    >
      <NavigationSearchProvider>
        {!isEmbeddedProjectPanel ? <AppSidebar /> : null}
        <div className="flex flex-1 flex-col min-h-0 h-svh overflow-hidden">
          {/* For project pages, EmbeddedStudioToolbar handles the header */}
          {!pageInfo.isProjectPage && !isEmbeddedProjectPanel && (
            <header
              className="sticky top-0 z-10 h-[var(--vivd-shell-header-height)] shrink-0 border-b bg-background px-3 transition-[border-color] duration-150 md:px-4"
              style={{ borderColor: isScrolled ? "hsl(var(--border))" : "transparent" }}
            >
              <HostHeader
                leadingAccessory={<SidebarTrigger className="rounded-md" />}
                leading={
                  <Breadcrumb>
                    <BreadcrumbList>
                      {pageInfo.isProjectPluginsPage && pageInfo.projectSlug ? (
                        <>
                          <BreadcrumbItem>
                            <HeaderBreadcrumbTextLink to={ROUTES.DASHBOARD}>
                              Projects
                            </HeaderBreadcrumbTextLink>
                          </BreadcrumbItem>
                          <BreadcrumbSeparator />
                          <BreadcrumbItem>
                            <HeaderBreadcrumbTextLink
                              to={ROUTES.PROJECT(pageInfo.projectSlug)}
                            >
                              {pageInfo.projectSlug}
                            </HeaderBreadcrumbTextLink>
                          </BreadcrumbItem>
                          <BreadcrumbSeparator />
                          <BreadcrumbItem>
                            <BreadcrumbPage>Plugins</BreadcrumbPage>
                          </BreadcrumbItem>
                        </>
                      ) : pageInfo.isProjectPluginPage && pageInfo.projectSlug ? (
                        <>
                          <BreadcrumbItem>
                            <HeaderBreadcrumbTextLink to={ROUTES.DASHBOARD}>
                              Projects
                            </HeaderBreadcrumbTextLink>
                          </BreadcrumbItem>
                          <BreadcrumbSeparator />
                          <BreadcrumbItem>
                            <HeaderBreadcrumbTextLink
                              to={ROUTES.PROJECT(pageInfo.projectSlug)}
                            >
                              {pageInfo.projectSlug}
                            </HeaderBreadcrumbTextLink>
                          </BreadcrumbItem>
                          <BreadcrumbSeparator />
                          <BreadcrumbItem>
                            <HeaderBreadcrumbTextLink
                              to={ROUTES.PROJECT_PLUGINS(pageInfo.projectSlug)}
                            >
                              Plugins
                            </HeaderBreadcrumbTextLink>
                          </BreadcrumbItem>
                          <BreadcrumbSeparator />
                          <BreadcrumbItem>
                            <BreadcrumbPage>{pageInfo.title}</BreadcrumbPage>
                          </BreadcrumbItem>
                        </>
                      ) : pageInfo.isScratchWizardPage ? (
                        <>
                          <BreadcrumbItem>
                            <HeaderBreadcrumbTextLink to={ROUTES.DASHBOARD}>
                              Projects
                            </HeaderBreadcrumbTextLink>
                          </BreadcrumbItem>
                          <BreadcrumbSeparator />
                          <BreadcrumbItem>
                            <BreadcrumbPage>New project</BreadcrumbPage>
                          </BreadcrumbItem>
                        </>
                      ) : (
                        <>
                          <BreadcrumbItem>
                            <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
                          </BreadcrumbItem>
                          {showNewProjectButton ? (
                            <>
                              <BreadcrumbSeparator />
                              <BreadcrumbItem>
                                <ProjectWizard />
                              </BreadcrumbItem>
                            </>
                          ) : null}
                        </>
                      )}
                    </BreadcrumbList>
                  </Breadcrumb>
                }
                showSearch
              />
            </header>
          )}
          <main
            ref={mainRef}
            className={`flex-1 min-h-0 ${
              pageInfo.isProjectPage
                ? "overflow-hidden"
                : pageInfo.isScratchWizardPage || pageInfo.isProjectsIndexPage
                  ? "overflow-hidden"
                  : isEmbeddedProjectPanel
                    ? "overflow-auto"
                    : "overflow-auto px-6 py-4"
            }`}
          >
            <Outlet />
          </main>
        </div>
      </NavigationSearchProvider>
    </SidebarProvider>
  );
}
