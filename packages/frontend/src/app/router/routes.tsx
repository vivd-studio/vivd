import { Routes, Route, Navigate } from "react-router-dom";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Signup from "@/pages/Signup";
import Admin from "@/pages/Admin";
import Organization from "@/pages/Organization";
import SuperAdmin from "@/pages/SuperAdmin";
import Settings from "@/pages/Settings";
import ProjectFullscreen from "@/pages/ProjectFullscreen";
import EmbeddedStudio from "@/pages/EmbeddedStudio";
import StudioFullscreen from "@/pages/StudioFullscreen";
import ScratchWizard from "@/pages/ScratchWizard";
import NoProjectAssigned from "@/pages/NoProjectAssigned";
import { Layout } from "@/components/shell";
import { SingleProjectModeHandler } from "@/components/projects";
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

/**
 * Layout wrapper with single project mode guard.
 */
function LayoutWithGuard() {
  return (
    <SingleProjectModeLayoutGuard>
      <Layout />
    </SingleProjectModeLayoutGuard>
  );
}

/**
 * Dashboard with client editor and single project mode handling.
 */
function DashboardRoute() {
  return (
    <DashboardClientEditorGuard>
      <Dashboard />
    </DashboardClientEditorGuard>
  );
}

/**
 * Embedded studio with client editor project assignment check.
 */
function EmbeddedStudioRoute() {
  return (
    <RequireAssignedProject>
      <EmbeddedStudio />
    </RequireAssignedProject>
  );
}

/**
 * Fullscreen preview with client editor project assignment check.
 */
function FullscreenProjectRoute() {
  return (
    <RequireAssignedProject>
      <ProjectFullscreen />
    </RequireAssignedProject>
  );
}

/**
 * Fullscreen studio (connected mode) with no layout chrome.
 */
function FullscreenStudioRoute() {
  return (
    <RequireAssignedProject>
      <StudioFullscreen />
    </RequireAssignedProject>
  );
}

/**
 * Scratch wizard with client editor handling.
 */
function ScratchWizardRoute() {
  return (
    <ScratchWizardClientEditorGuard>
      <ScratchWizard />
    </ScratchWizardClientEditorGuard>
  );
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
        <Route path="*" element={<Signup />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Login - accessible without auth, redirects if already logged in */}
      <Route
        path={ROUTES.LOGIN}
        element={
          !session ? <Login /> : <Navigate to={ROUTES.DASHBOARD} replace />
        }
      />

      {/* Single project mode route - outside Layout to avoid project overview */}
      <Route
        path={ROUTES.SINGLE_PROJECT}
        element={
          <RequireAuth>
            <SingleProjectModeHandler />
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
        <Route path="settings" element={<Settings />} />
        <Route
          path="org"
          element={
            <RequireOrgAdmin>
              <Organization />
            </RequireOrgAdmin>
          }
        />
        <Route path="no-project" element={<NoProjectAssigned />} />
        <Route
          path="admin"
          element={
            <RequireOrgAdmin>
              <Admin />
            </RequireOrgAdmin>
          }
        />
        <Route
          path="superadmin"
          element={
            <RequireSuperAdmin>
              <SuperAdmin />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="superadmin/users"
          element={
            <RequireSuperAdmin>
              <Navigate to={`${ROUTES.SUPERADMIN_BASE}?tab=users`} replace />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="superadmin/orgs"
          element={
            <RequireSuperAdmin>
              <Navigate to={`${ROUTES.SUPERADMIN_BASE}?tab=orgs`} replace />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="superadmin/maintenance"
          element={
            <RequireSuperAdmin>
              <Navigate to={`${ROUTES.SUPERADMIN_BASE}?tab=maintenance`} replace />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="superadmin/usage"
          element={
            <RequireSuperAdmin>
              <Navigate to={`${ROUTES.ADMIN}?tab=usage`} replace />
            </RequireSuperAdmin>
          }
        />
        {/* Embedded studio view inside Layout */}
        <Route path="projects/:projectSlug" element={<EmbeddedStudioRoute />} />
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

      {/* Scratch wizard for new projects */}
      <Route
        path={ROUTES.NEW_SCRATCH}
        element={
          <RequireAuth>
            <ScratchWizardRoute />
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
