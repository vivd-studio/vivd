import { useParams, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatDocumentTitle } from "@/lib/brand";
import { PreviewContent } from "@/components/preview/PreviewContent";
import { PreviewProvider } from "@/components/preview/PreviewContext";
import { ROUTES } from "@/app/router";

export default function PreviewPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();

  // Fetch project data to get current version
  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const version = project?.currentVersion || 1;

  const handleClose = () => {
    if (projectSlug) {
      navigate(ROUTES.PROJECT(projectSlug));
    }
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
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading preview...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-destructive">
          Error loading project: {error.message}
        </div>
      </div>
    );
  }

  if (!project || !projectSlug) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
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
    >
      <PreviewContent />
    </PreviewProvider>
  );
}
