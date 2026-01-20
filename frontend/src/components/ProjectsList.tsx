import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { ProjectCard } from "./ProjectCard";
import { VersionDialog } from "./VersionDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { toast } from "sonner";

interface VersionDialogData {
  slug: string;
  url: string;
  currentVersion: number;
  totalVersions: number;
}

export function ProjectsList() {
  const {
    data: projectsData,
    isLoading,
    error,
  } = trpc.project.list.useQuery(undefined, {
    refetchInterval: 2000, // Poll every 2 seconds to check status
  });
  const { mutateAsync: regenerateProject } =
    trpc.project.regenerate.useMutation();
  const { mutateAsync: generateProject } = trpc.project.generate.useMutation();
  const deleteProjectMutation = trpc.project.delete.useMutation({
    onSuccess: (data) => {
      toast.success("Project Deleted", {
        description: data.message,
      });
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Delete Failed", {
        description: error.message,
      });
    },
  });
  const utils = trpc.useUtils();
  const [regeneratingSlug, setRegeneratingSlug] = useState<string | null>(null);
  const [versionDialogData, setVersionDialogData] =
    useState<VersionDialogData | null>(null);
  const [deleteDialogSlug, setDeleteDialogSlug] = useState<string | null>(null);

  const handleCreateNewClick = (slug: string, version?: number) => {
    // Find the project to get its URL and version info
    const project = projectsData?.projects.find((p) => p.slug === slug);
    if (project) {
      setVersionDialogData({
        slug: project.slug,
        url: project.url,
        currentVersion: version ?? project.currentVersion ?? 1,
        totalVersions: project.totalVersions ?? 1,
      });
    }
  };

  const handleCreateNewVersion = async () => {
    if (!versionDialogData) return;
    const { url } = versionDialogData;
    setVersionDialogData(null);

    setRegeneratingSlug(versionDialogData.slug);
    try {
      await generateProject({ url, createNewVersion: true });
    } catch (error) {
      console.error(error);
      toast.error("Failed to create new version", {
        description: (error as Error).message,
      });
    } finally {
      setRegeneratingSlug(null);
    }
  };

  const handleOverwriteCurrent = async () => {
    if (!versionDialogData) return;
    const { slug, currentVersion } = versionDialogData;
    setVersionDialogData(null);

    setRegeneratingSlug(slug);
    try {
      await regenerateProject({ slug, version: currentVersion });
    } catch (error) {
      console.error(error);
      toast.error(`Failed to regenerate ${slug}`, {
        description: (error as Error).message,
      });
    } finally {
      setRegeneratingSlug(null);
    }
  };

  const handleDeleteClick = (slug: string) => {
    setDeleteDialogSlug(slug);
  };

  const handleConfirmDelete = (confirmationText: string) => {
    if (!deleteDialogSlug) return;
    deleteProjectMutation.mutate({
      slug: deleteDialogSlug,
      confirmationText,
    });
    setDeleteDialogSlug(null);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-44 rounded-lg border bg-card text-card-foreground shadow-sm animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error)
    return <div className="text-destructive">Error loading projects</div>;

  return (
    <div>
      {projectsData?.projects.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg bg-muted/30">
          <p className="text-muted-foreground">
            No projects yet. Click "New Project" to create one!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
          {projectsData?.projects.map((project) => (
            <ProjectCard
              key={project.slug}
              project={project}
              onRegenerate={handleCreateNewClick}
              onDelete={handleDeleteClick}
              isRegenerating={regeneratingSlug === project.slug}
            />
          ))}
        </div>
      )}

      <VersionDialog
        open={!!versionDialogData}
        onOpenChange={(open) => !open && setVersionDialogData(null)}
        onCreateNewVersion={handleCreateNewVersion}
        onOverwriteCurrent={handleOverwriteCurrent}
        projectName={versionDialogData?.slug}
        currentVersion={versionDialogData?.currentVersion ?? 1}
        totalVersions={versionDialogData?.totalVersions ?? 1}
      />

      <DeleteProjectDialog
        open={!!deleteDialogSlug}
        onOpenChange={(open) => !open && setDeleteDialogSlug(null)}
        onConfirmDelete={handleConfirmDelete}
        projectName={deleteDialogSlug ?? ""}
        isDeleting={deleteProjectMutation.isPending}
      />
    </div>
  );
}
