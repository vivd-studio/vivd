import { useParams, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatDocumentTitle } from "@/lib/brand";
import { PreviewContent } from "@/components/preview/PreviewContent";
import { PreviewProvider } from "@/components/preview/PreviewContext";
import { ROUTES } from "@/app/router";

/**
 * EmbeddedStudio - Renders the studio view embedded within the Layout (with sidebar/breadcrumbs).
 * This uses PreviewProvider with embedded=true to fit within the Layout's main content area.
 */
export default function EmbeddedStudio() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();

  // Fetch project data to get current version
  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const version = project?.currentVersion || 1;

  // Handle close/back navigation
  const handleClose = () => {
    navigate(ROUTES.DASHBOARD);
  };

  // Set document title to project name
  useEffect(() => {
    if (project?.slug) {
      document.title = formatDocumentTitle(project.slug);
    }
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [project?.slug]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading preview...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-destructive">
          Error loading project: {error.message}
        </div>
      </div>
    );
  }

  if (!project || !projectSlug) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Project not found</div>
      </div>
    );
  }

  return (
    <PreviewProvider
      url={null}
      originalUrl={project.url}
      projectSlug={projectSlug}
      version={version}
      onClose={handleClose}
      embedded={true}
    >
      <PreviewContent />
    </PreviewProvider>
  );
}
