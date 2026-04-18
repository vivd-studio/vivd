import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Navigate, useSearchParams } from "react-router-dom";
import { RouteLoadingIndicator } from "@/components/common";
import { authClient } from "@/lib/auth-client";
import { ROUTES } from "./paths";
import {
  RequireAuth,
  RequireOrgAdmin,
  RequireAssignedProject,
  RequireSuperAdmin,
  SingleProjectModeLayoutGuard,
  DashboardClientEditorGuard,
  ScratchWizardClientEditorGuard,
} from "./guards";

const Login = lazy(() => import("@/pages/Login"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const InviteAccept = lazy(() => import("@/pages/InviteAccept"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Signup = lazy(() => import("@/pages/Signup"));
const Organization = lazy(() => import("@/pages/Organization"));
const SuperAdmin = lazy(() => import("@/pages/SuperAdmin"));
const Settings = lazy(() => import("@/pages/Settings"));
const ProjectFullscreen = lazy(() => import("@/pages/ProjectFullscreen"));
const EmbeddedStudio = lazy(() => import("@/pages/EmbeddedStudio"));
const StudioFullscreen = lazy(() => import("@/pages/StudioFullscreen"));
const ScratchWizard = lazy(() => import("@/pages/ScratchWizard"));
const NoProjectAssigned = lazy(() => import("@/pages/NoProjectAssigned"));
const ProjectPlugins = lazy(() => import("@/pages/ProjectPlugins"));
const ProjectPluginPage = lazy(() => import("@/pages/ProjectPluginPage"));
const ProjectPluginOperatorPage = lazy(
  () => import("@/pages/ProjectPluginOperatorPage"),
);
const Layout = lazy(() =>
  import("@/components/shell/Layout").then((module) => ({
    default: module.Layout,
  })),
);
const SingleProjectModeHandler = lazy(() =>
  import("@/components/projects/create/SingleProjectModeHandler").then(
    (module) => ({
      default: module.SingleProjectModeHandler,
    }),
  ),
);

function RouteSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteLoadingIndicator />}>{children}</Suspense>;
}

/**
 * Layout wrapper with single project mode guard.
 */
function LayoutWithGuard() {
  return (
    <SingleProjectModeLayoutGuard>
      <RouteSuspense>
        <Layout />
      </RouteSuspense>
    </SingleProjectModeLayoutGuard>
  );
}

/**
 * Dashboard with client editor and single project mode handling.
 */
function DashboardRoute() {
  return (
    <DashboardClientEditorGuard>
      <RouteSuspense>
        <Dashboard />
      </RouteSuspense>
    </DashboardClientEditorGuard>
  );
}

/**
 * Embedded studio with client editor project assignment check.
 */
function EmbeddedStudioRoute() {
  return (
    <RequireAssignedProject>
      <RouteSuspense>
        <EmbeddedStudio />
      </RouteSuspense>
    </RequireAssignedProject>
  );
}

function ProjectPluginsRoute() {
  return (
    <RequireAssignedProject>
      <RouteSuspense>
        <ProjectPlugins />
      </RouteSuspense>
    </RequireAssignedProject>
  );
}

function ProjectPluginRoute() {
  return (
    <RequireAssignedProject>
      <RouteSuspense>
        <ProjectPluginPage />
      </RouteSuspense>
    </RequireAssignedProject>
  );
}

function ProjectPluginOperatorRoute() {
  return (
    <RequireAssignedProject>
      <RouteSuspense>
        <ProjectPluginOperatorPage />
      </RouteSuspense>
    </RequireAssignedProject>
  );
}

/**
 * Fullscreen preview with client editor project assignment check.
 */
function FullscreenProjectRoute() {
  return (
    <RequireAssignedProject>
      <RouteSuspense>
        <ProjectFullscreen />
      </RouteSuspense>
    </RequireAssignedProject>
  );
}

/**
 * Fullscreen studio (connected mode) with no layout chrome.
 */
function FullscreenStudioRoute() {
  return (
    <RequireAssignedProject>
      <RouteSuspense>
        <StudioFullscreen />
      </RouteSuspense>
    </RequireAssignedProject>
  );
}

/**
 * Scratch wizard with client editor handling.
 */
function ScratchWizardRoute() {
  return (
    <ScratchWizardClientEditorGuard>
      <RouteSuspense>
        <ScratchWizard />
      </RouteSuspense>
    </ScratchWizardClientEditorGuard>
  );
}

/**
 * Backward-compat redirect from old /admin routes to /org.
 * Maps ?tab=users → ?tab=members; usage and maintenance pass through.
 */
function AdminRedirect() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  let newTab = "members";
  if (tab === "usage") newTab = "usage";
  else if (tab === "maintenance") newTab = "maintenance";
  return <Navigate to={`${ROUTES.ORG}?tab=${newTab}`} replace />;
}

interface AppRoutesProps {
  hasUsers: boolean;
}

/**
 * Main application routes.
 * Handles the "no users" edge case (first-run signup flow) at the top level.
 */
export function AppRoutes({ hasUsers }: AppRoutesProps) {
  const { data: session } = authClient.useSession();

  // If no users exist, force signup for first admin
  if (!hasUsers) {
    return (
      <Routes>
        <Route
          path="*"
          element={
            <RouteSuspense>
              <Signup />
            </RouteSuspense>
          }
        />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Login - accessible without auth, redirects if already logged in */}
      <Route
        path={ROUTES.LOGIN}
        element={
          !session ? (
            <RouteSuspense>
              <Login />
            </RouteSuspense>
          ) : (
            <Navigate to={ROUTES.DASHBOARD} replace />
          )
        }
      />
      <Route
        path={ROUTES.FORGOT_PASSWORD}
        element={
          !session ? (
            <RouteSuspense>
              <ForgotPassword />
            </RouteSuspense>
          ) : (
            <Navigate to={ROUTES.DASHBOARD} replace />
          )
        }
      />
      <Route
        path={ROUTES.RESET_PASSWORD}
        element={
          <RouteSuspense>
            <ResetPassword />
          </RouteSuspense>
        }
      />
      <Route
        path={ROUTES.INVITE_ACCEPT}
        element={
          <RouteSuspense>
            <InviteAccept />
          </RouteSuspense>
        }
      />

      {/* Single project mode route - outside Layout to avoid project overview */}
      <Route
        path={ROUTES.SINGLE_PROJECT}
        element={
          <RequireAuth>
            <RouteSuspense>
              <SingleProjectModeHandler />
            </RouteSuspense>
          </RequireAuth>
        }
      />

      {/* Nested routes under /vivd-studio with Layout */}
      <Route
        path={ROUTES.STUDIO_BASE}
        element={
          <RequireAuth>
            <LayoutWithGuard />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardRoute />} />
        <Route
          path="settings"
          element={
            <RouteSuspense>
              <Settings />
            </RouteSuspense>
          }
        />
        <Route
          path="org"
          element={
            <RequireOrgAdmin>
              <RouteSuspense>
                <Organization />
              </RouteSuspense>
            </RequireOrgAdmin>
          }
        />
        <Route
          path="no-project"
          element={
            <RouteSuspense>
              <NoProjectAssigned />
            </RouteSuspense>
          }
        />
        <Route path="admin" element={<AdminRedirect />} />
        <Route
          path="superadmin"
          element={
            <RequireSuperAdmin>
              <RouteSuspense>
                <SuperAdmin />
              </RouteSuspense>
            </RequireSuperAdmin>
          }
        />
        <Route
          path="superadmin/users"
          element={
            <RequireSuperAdmin>
              <Navigate to={`${ROUTES.SUPERADMIN_BASE}?section=users`} replace />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="superadmin/orgs"
          element={
            <RequireSuperAdmin>
              <Navigate to={`${ROUTES.SUPERADMIN_BASE}?section=org`} replace />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="superadmin/maintenance"
          element={
            <RequireSuperAdmin>
              <Navigate to={`${ROUTES.SUPERADMIN_BASE}?section=maintenance`} replace />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="superadmin/machines"
          element={
            <RequireSuperAdmin>
              <Navigate to={`${ROUTES.SUPERADMIN_BASE}?section=machines`} replace />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="superadmin/usage"
          element={
            <RequireSuperAdmin>
              <Navigate to={`${ROUTES.ORG}?tab=usage`} replace />
            </RequireSuperAdmin>
          }
        />
        {/* Embedded studio view inside Layout */}
        <Route path="projects/new/scratch" element={<ScratchWizardRoute />} />
        <Route path="projects/:projectSlug" element={<EmbeddedStudioRoute />} />
        <Route path="projects/:projectSlug/plugins" element={<ProjectPluginsRoute />} />
        <Route
          path="projects/:projectSlug/plugins/:pluginId/*"
          element={<ProjectPluginRoute />}
        />
      </Route>

      {/* Fullscreen project view (no layout chrome) */}
      <Route
        path="/vivd-studio/projects/:projectSlug/fullscreen"
        element={
          <RequireAuth>
            <FullscreenProjectRoute />
          </RequireAuth>
        }
      />

      {/* Fullscreen Studio (connected) - outside Layout */}
      <Route
        path="/vivd-studio/projects/:projectSlug/studio-fullscreen"
        element={
          <RequireAuth>
            <FullscreenStudioRoute />
          </RequireAuth>
        }
      />

      {/* Plugin operator (service-mode) fullscreen - outside Layout */}
      <Route
        path="/vivd-studio/projects/:projectSlug/plugins/:pluginId/operator"
        element={
          <RequireAuth>
            <ProjectPluginOperatorRoute />
          </RequireAuth>
        }
      />

      {/* Root redirect */}
      <Route
        path={ROUTES.ROOT}
        element={
          session ? (
            <Navigate to={ROUTES.DASHBOARD} replace />
          ) : (
            <Navigate to={ROUTES.LOGIN} replace />
          )
        }
      />
    </Routes>
  );
}
