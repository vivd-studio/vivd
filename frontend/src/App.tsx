import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router-dom";
import { useEffect } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Signup from "./pages/Signup";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";
import PreviewPage from "./pages/PreviewPage";
import EmbeddedStudio from "./pages/EmbeddedStudio";
import ScratchWizard from "./pages/ScratchWizard";
import NoProjectAssigned from "./pages/NoProjectAssigned";
import { Layout } from "@/components/Layout";
import { SingleProjectModeHandler } from "@/components/SingleProjectModeHandler";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { useAppConfig } from "@/lib/AppConfigContext";
import { formatDocumentTitle } from "@/lib/brand";
import { Toaster } from "@/components/ui/sonner";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * Dashboard wrapper that handles single project mode routing.
 * In single project mode: redirects to first project or shows creation wizard.
 * In normal mode: shows the regular Dashboard.
 *
 * NOTE: Single project mode is now handled separately at the route level
 * to bypass the Layout component entirely. See SingleProjectDashboardRoute.
 */
function DashboardRoute() {
  const { config, isLoading } = useAppConfig();
  const { isClientEditor } = usePermissions();
  const { data: assignedProject, isLoading: isProjectLoading } =
    trpc.user.getMyAssignedProject.useQuery(undefined, {
      enabled: isClientEditor,
    });

  if (isLoading || (isClientEditor && isProjectLoading)) {
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    );
  }

  // Auto-redirect client editors to their assigned project
  if (isClientEditor && assignedProject?.projectSlug) {
    return (
      <Navigate
        to={`/vivd-studio/projects/${assignedProject.projectSlug}`}
        replace
      />
    );
  }

  // Client editors must have an assigned project
  if (isClientEditor && !assignedProject?.projectSlug) {
    return <Navigate to="/vivd-studio/no-project" replace />;
  }

  // In single project mode, redirect to the dedicated route that bypasses Layout
  if (config.singleProjectMode) {
    return <Navigate to="/vivd-studio/single-project" replace />;
  }

  return <Dashboard />;
}

/**
 * Dedicated route for single project mode that bypasses the Layout.
 * Redirects to studio if project exists, or shows creation wizard.
 */
function SingleProjectDashboardRoute() {
  return <SingleProjectModeHandler />;
}

function ProjectRoute() {
  const { isClientEditor } = usePermissions();
  const params = useParams();
  const projectSlug = params.projectSlug ?? "";

  const { data: assignedProject, isLoading } =
    trpc.user.getMyAssignedProject.useQuery(undefined, {
      enabled: isClientEditor,
    });

  if (!isClientEditor) return <PreviewPage />;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!assignedProject?.projectSlug) {
    return <Navigate to="/vivd-studio/no-project" replace />;
  }

  if (projectSlug && assignedProject.projectSlug !== projectSlug) {
    return (
      <Navigate
        to={`/vivd-studio/projects/${assignedProject.projectSlug}`}
        replace
      />
    );
  }

  return <PreviewPage />;
}

function EmbeddedStudioRoute() {
  const { isClientEditor } = usePermissions();
  const params = useParams();
  const projectSlug = params.projectSlug ?? "";

  const { data: assignedProject, isLoading } =
    trpc.user.getMyAssignedProject.useQuery(undefined, {
      enabled: isClientEditor,
    });

  if (!isClientEditor) return <EmbeddedStudio />;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">Loading...</div>
    );
  }

  if (!assignedProject?.projectSlug) {
    return <Navigate to="/vivd-studio/no-project" replace />;
  }

  if (projectSlug && assignedProject.projectSlug !== projectSlug) {
    return (
      <Navigate
        to={`/vivd-studio/projects/${assignedProject.projectSlug}`}
        replace
      />
    );
  }

  return <EmbeddedStudio />;
}

function ScratchWizardRoute() {
  const { isClientEditor } = usePermissions();
  const { data: assignedProject, isLoading } =
    trpc.user.getMyAssignedProject.useQuery(undefined, {
      enabled: isClientEditor,
    });

  if (!isClientEditor) return <ScratchWizard />;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!assignedProject?.projectSlug) {
    return <Navigate to="/vivd-studio/no-project" replace />;
  }

  return (
    <Navigate
      to={`/vivd-studio/projects/${assignedProject.projectSlug}`}
      replace
    />
  );
}

export default function App() {
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();

  useEffect(() => {
    document.title = formatDocumentTitle();
  }, []);

  const {
    data: hasUsersData,
    isLoading: isHasUsersLoading,
    isError,
    error,
  } = trpc.user.hasUsers.useQuery();

  if (isSessionPending || isHasUsersLoading)
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    );

  if (isError) {
    return (
      <div className="p-4 text-red-500">
        Error checking system status. Please check console and backend logs.{" "}
        {String(error)}
      </div>
    );
  }

  // If no users exist, force signup
  // We explicitly check for false, or if data is missing but no error (edge case) we treat as false just in case
  if (hasUsersData && hasUsersData.hasUsers === false) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Signup />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    );
  }

  // Normal flow
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/vivd-studio/login"
          element={!session ? <Login /> : <Navigate to="/vivd-studio" />}
        />
        {/* Single project mode route - outside Layout to avoid project overview */}
        <Route
          path="/vivd-studio/single-project"
          element={
            session ? (
              <SingleProjectDashboardRoute />
            ) : (
              <Navigate to="/vivd-studio/login" />
            )
          }
        />
        {/* Nested routes under /vivd-studio with Layout */}
        <Route
          path="/vivd-studio"
          element={session ? <Layout /> : <Navigate to="/vivd-studio/login" />}
        >
          <Route index element={<DashboardRoute />} />
          <Route path="settings" element={<Settings />} />
          <Route path="no-project" element={<NoProjectAssigned />} />
          <Route
            path="admin"
            element={
              session?.user?.role === "admin" ? (
                <Admin />
              ) : (
                <Navigate to="/vivd-studio" />
              )
            }
          />
          {/* Embedded studio view inside Layout */}
          <Route
            path="projects/:projectSlug"
            element={<EmbeddedStudioRoute />}
          />
        </Route>
        {/* Fullscreen PreviewPage - outside Layout for immersive editing */}
        <Route
          path="/vivd-studio/projects/:projectSlug/fullscreen"
          element={
            session ? <ProjectRoute /> : <Navigate to="/vivd-studio/login" />
          }
        />
        <Route
          path="/vivd-studio/projects/new/scratch"
          element={
            session ? (
              <ScratchWizardRoute />
            ) : (
              <Navigate to="/vivd-studio/login" />
            )
          }
        />
        <Route
          path="/"
          element={
            session ? (
              <Navigate to="/vivd-studio" />
            ) : (
              <Navigate to="/vivd-studio/login" />
            )
          }
        />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
