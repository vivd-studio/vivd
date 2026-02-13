import { Navigate, useLocation, useParams } from "react-router-dom";
import { type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { useAppConfig } from "@/lib/AppConfigContext";
import { usePermissions } from "@/hooks/usePermissions";
import { ROUTES } from "./paths";
import { CenteredLoading as Loading } from "@/components/common";
import { Button } from "@/components/ui/button";

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

/**
 * Requires an authenticated session.
 * Redirects to login if no session exists.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  const { config, isLoading } = useAppConfig();

  if (!session) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  if (isLoading) {
    return <Loading />;
  }

  if (!config.hasHostOrganizationAccess) {
    const controlPlaneUrl = config.controlPlaneHost
      ? `${inferSchemeForHost(config.controlPlaneHost)}://${config.controlPlaneHost}${ROUTES.DASHBOARD}`
      : ROUTES.DASHBOARD;

    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-lg border bg-card p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Wrong tenant host</h1>
            <p className="text-sm text-muted-foreground mt-1">
              This domain is pinned to an organization your account cannot access.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <a href={controlPlaneUrl}>Go to control plane</a>
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await authClient.signOut();
                window.location.assign(ROUTES.LOGIN);
              }}
            >
              Log out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Requires admin role.
 * Redirects to dashboard if user is not an org admin.
 */
export function RequireOrgAdmin({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  const { data: membership, isLoading } =
    trpc.organization.getMyMembership.useQuery(undefined, {
      enabled: !!session,
    });

  if (!session) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  if (isLoading) {
    return <Loading />;
  }

  if (!membership?.isOrganizationAdmin) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  return <>{children}</>;
}

/**
 * Requires super-admin role AND that the current host is allowed for the super-admin panel.
 */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  const { config, isLoading } = useAppConfig();

  if (!session) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  if (isLoading) {
    return <Loading />;
  }

  if (session.user.role !== "super_admin" || !config.isSuperAdminHost) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  return <>{children}</>;
}

/**
 * For client_editor users: ensures they have an assigned project
 * and are accessing their assigned project (not someone else's).
 *
 * Non-client_editor users pass through freely.
 */
export function RequireAssignedProject({ children }: { children: ReactNode }) {
  const { isClientEditor } = usePermissions();
  const params = useParams();
  const projectSlug = params.projectSlug ?? "";

  const { data: assignedProject, isLoading } =
    trpc.user.getMyAssignedProject.useQuery(undefined, {
      enabled: isClientEditor,
    });

  // Non-client_editor users bypass this guard
  if (!isClientEditor) {
    return <>{children}</>;
  }

  if (isLoading) {
    return <Loading />;
  }

  // Client editor must have an assigned project
  if (!assignedProject?.projectSlug) {
    return <Navigate to={ROUTES.NO_PROJECT} replace />;
  }

  // If accessing a specific project, must be their assigned one
  if (projectSlug && assignedProject.projectSlug !== projectSlug) {
    return (
      <Navigate to={ROUTES.PROJECT_FULLSCREEN(assignedProject.projectSlug)} replace />
    );
  }

  return <>{children}</>;
}

/**
 * Handles single-project-mode logic for the Layout wrapper.
 * In single project mode:
 * - Admin and Settings pages remain accessible
 * - Project list (dashboard) and embedded studio redirect to fullscreen
 */
export function SingleProjectModeLayoutGuard({
  children,
}: {
  children: ReactNode;
}) {
  const { config, isLoading } = useAppConfig();
  const location = useLocation();
  const { data: projectsData, isLoading: isProjectsLoading } =
    trpc.project.list.useQuery();

  if (isLoading || isProjectsLoading) {
    return <Loading />;
  }

  // In single project mode, only redirect project-related routes to fullscreen
  // Admin and Settings pages should remain accessible
  if (config.singleProjectMode) {
    const isAdminRoute = location.pathname.startsWith("/vivd-studio/admin");
    const isSettingsRoute = location.pathname.startsWith(ROUTES.SETTINGS);
    const isSuperAdminRoute = location.pathname.startsWith(ROUTES.SUPERADMIN_BASE);
    const isOrgRoute = location.pathname.startsWith(ROUTES.ORG);

    // Allow admin and settings pages through
    if (isAdminRoute || isSettingsRoute || isSuperAdminRoute || isOrgRoute) {
      return <>{children}</>;
    }

    // Redirect project list and embedded studio to fullscreen
    const projects = projectsData?.projects ?? [];
    if (projects.length > 0) {
      return (
        <Navigate to={ROUTES.PROJECT_FULLSCREEN(projects[0].slug)} replace />
      );
    }
    // No projects yet - redirect to single project creation flow
    return <Navigate to={ROUTES.SINGLE_PROJECT} replace />;
  }

  // Normal mode: render children
  return <>{children}</>;
}

/**
 * Handles dashboard routing for client_editor users.
 * Redirects them to their assigned project or shows no-project page.
 */
export function DashboardClientEditorGuard({
  children,
}: {
  children: ReactNode;
}) {
  const { config, isLoading: isConfigLoading } = useAppConfig();
  const { isClientEditor } = usePermissions();
  const { data: assignedProject, isLoading: isProjectLoading } =
    trpc.user.getMyAssignedProject.useQuery(undefined, {
      enabled: isClientEditor,
    });

  if (isConfigLoading || (isClientEditor && isProjectLoading)) {
    return <Loading />;
  }

  // Auto-redirect client editors to their assigned project (fullscreen mode)
  if (isClientEditor && assignedProject?.projectSlug) {
    return (
      <Navigate to={ROUTES.PROJECT_FULLSCREEN(assignedProject.projectSlug)} replace />
    );
  }

  // Client editors must have an assigned project
  if (isClientEditor && !assignedProject?.projectSlug) {
    return <Navigate to={ROUTES.NO_PROJECT} replace />;
  }

  // In single project mode, redirect to the dedicated route that bypasses Layout
  if (config.singleProjectMode) {
    return <Navigate to={ROUTES.SINGLE_PROJECT} replace />;
  }

  return <>{children}</>;
}

/**
 * Handles scratch wizard routing for client_editor users.
 * Client editors can't create new projects - redirect to their assigned project.
 */
export function ScratchWizardClientEditorGuard({
  children,
}: {
  children: ReactNode;
}) {
  const { isClientEditor } = usePermissions();
  const { data: assignedProject, isLoading } =
    trpc.user.getMyAssignedProject.useQuery(undefined, {
      enabled: isClientEditor,
    });

  // Non-client_editor users can access scratch wizard normally
  if (!isClientEditor) {
    return <>{children}</>;
  }

  if (isLoading) {
    return <Loading />;
  }

  if (!assignedProject?.projectSlug) {
    return <Navigate to={ROUTES.NO_PROJECT} replace />;
  }

  // Always redirect client_editor to fullscreen mode
  return <Navigate to={ROUTES.PROJECT_FULLSCREEN(assignedProject.projectSlug)} replace />;
}
