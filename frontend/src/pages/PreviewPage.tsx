import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { PreviewContent } from "@/components/preview/PreviewContent";
import { PreviewProvider } from "@/components/preview/PreviewContext";

export default function PreviewPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const [isReady, setIsReady] = useState(false);

  // Fetch project data to get current version
  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const version = project?.currentVersion || 1;
  const previewUrl = projectSlug
    ? `/api/preview/${projectSlug}/v${version}/index.html`
    : null;

  // Handle close/back navigation
  const handleClose = () => {
    navigate("/vivd-studio");
  };

  // Set ready once we have project data
  useEffect(() => {
    if (project) {
      setIsReady(true);
    }
  }, [project]);

  // Set document title to project name
  useEffect(() => {
    if (project?.slug) {
      document.title = `vivd - ${project.slug}`;
    }
    return () => {
      document.title = "vivd";
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

  if (!isReady || !previewUrl) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <PreviewProvider
      url={previewUrl}
      originalUrl={project.url}
      projectSlug={projectSlug}
      version={version}
      onClose={handleClose}
    >
      <PreviewContent />
    </PreviewProvider>
  );
}
