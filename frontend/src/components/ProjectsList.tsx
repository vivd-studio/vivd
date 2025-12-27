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
      alert(`Failed to create new version: ${(error as Error).message}`);
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
      alert(`Failed to regenerate ${slug}: ${(error as Error).message}`);
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
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-48 rounded-xl border bg-card text-card-foreground shadow animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error)
    return <div className="mt-8 text-red-500">Error loading projects</div>;

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold tracking-tight mb-4">Your Projects</h2>
      {projectsData?.projects.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-xl">
          <p className="text-muted-foreground">
            No projects generated yet. create one above!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
