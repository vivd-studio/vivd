import { Navigate } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { SingleProjectCreateView } from "./SingleProjectCreateView";

/**
 * Handler component for single project mode.
 * - If projects exist: redirects to the first project's studio view
 * - If no projects: shows the fullscreen creation wizard
 */
export function SingleProjectModeHandler() {
  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-red-500">
        Error loading projects: {error.message}
      </div>
    );
  }

  const projects = projectsData?.projects ?? [];

  // If projects exist, redirect to the first one
  if (projects.length > 0) {
    return (
      <Navigate to={`/vivd-studio/projects/${projects[0].slug}`} replace />
    );
  }

  // No projects - show creation view
  return <SingleProjectCreateView />;
}
