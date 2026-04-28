import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type DuplicateProjectResult = RouterOutputs["project"]["duplicateProject"];
type ProjectListResult = RouterOutputs["project"]["list"];

interface UseProjectCardMutationsArgs {
  projectSlug: string;
  selectedVersion: number;
  onRenameSuccess: () => void;
  onTitleUpdateSuccess: (title: string) => void;
  onDuplicateProjectSuccess: (result: DuplicateProjectResult) => void;
}

export function useProjectCardMutations({
  projectSlug,
  selectedVersion,
  onRenameSuccess,
  onTitleUpdateSuccess,
  onDuplicateProjectSuccess,
}: UseProjectCardMutationsArgs) {
  const utils = trpc.useUtils();
  const duplicateProjectToastId = `duplicate-project-${projectSlug}`;

  const setStatusMutation = trpc.project.setStatus.useMutation({
    onSuccess: (data, variables) => {
      toast.success("Project status updated", {
        description: data.message,
      });
      utils.project.list.invalidate();
      utils.project.status.invalidate({
        slug: variables.slug,
        version: variables.version,
      });
    },
    onError: (error) => {
      toast.error("Status update failed", {
        description: error.message,
      });
    },
  });

  const setCurrentVersionMutation = trpc.project.setCurrentVersion.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to set version", {
        description: error.message,
      });
    },
  });

  const regenerateThumbnailMutation =
    trpc.project.regenerateThumbnail.useMutation({
      onSuccess: (_data, variables) => {
        toast.success("Thumbnail regenerated", {
          description: `${variables.slug} v${variables.version}`,
        });
        utils.project.list.invalidate();
      },
      onError: (error) => {
        toast.error("Failed to regenerate thumbnail", {
          description: error.message,
        });
      },
    });

  const updateTagsMutation = trpc.project.updateTags.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      utils.project.listTags.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to update tags", {
        description: error.message,
      });
    },
  });

  const deleteTagMutation = trpc.project.deleteTag.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      utils.project.listTags.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to delete label", {
        description: error.message,
      });
    },
  });

  const renameTagMutation = trpc.project.renameTag.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      utils.project.listTags.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to rename label", {
        description: error.message,
      });
    },
  });

  const setTagColorMutation = trpc.project.setTagColor.useMutation({
    onSuccess: () => {
      utils.project.listTags.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to update label color", {
        description: error.message,
      });
    },
  });

  const renameSlugMutation = trpc.project.renameSlug.useMutation({
    onSuccess: (data) => {
      toast.success("Project renamed", {
        description: `${data.oldSlug} -> ${data.newSlug}`,
      });
      onRenameSuccess();
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to rename project", {
        description: error.message,
      });
    },
  });

  const updateTitleMutation = trpc.project.updateTitle.useMutation({
    onSuccess: (data) => {
      toast.success("Project title updated", {
        description: `New title: ${data.title}`,
      });
      onTitleUpdateSuccess(data.title);
      utils.project.list.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to update project title", {
        description: error.message,
      });
    },
  });

  const duplicateProjectMutation = trpc.project.duplicateProject.useMutation({
    onMutate: async (variables) => {
      await utils.project.list.cancel();
      const previousList = utils.project.list.getData();
      const createdAt = new Date().toISOString();
      const targetSlug =
        variables.slug?.trim() || `${variables.sourceSlug.trim()}-copy`;
      const targetTitle = variables.title?.trim() || targetSlug;

      utils.project.list.setData(undefined, (current): ProjectListResult | undefined => {
        if (!current) return current;
        return {
          ...current,
          projects: [
            {
              slug: targetSlug,
              url: "",
              source: "scratch",
              title: targetTitle,
              tags: [],
              status: "duplicating_project",
              createdAt,
              updatedAt: createdAt,
              currentVersion: 1,
              totalVersions: 1,
              versions: [
                {
                  version: 1,
                  createdAt,
                  status: "duplicating_project",
                },
              ],
              publishedDomain: null,
              publishedVersion: null,
              thumbnailUrl: null,
              publicPreviewEnabled: false,
              enabledPlugins: [],
            },
            ...current.projects.filter((project) => project.slug !== targetSlug),
          ],
        };
      });

      toast.loading("Duplicating project", {
        id: duplicateProjectToastId,
        description: `Copying ${variables.sourceSlug} v${variables.sourceVersion ?? selectedVersion} as a new project...`,
      });

      return { previousList };
    },
    onSuccess: async (data) => {
      toast.success("Project duplicated", {
        id: duplicateProjectToastId,
        description: `${data.targetSlug} v${data.targetVersion} is ready.`,
      });
      await utils.project.list.invalidate();
      await utils.project.list.refetch();
      await utils.project.status.invalidate({
        slug: data.targetSlug,
        version: data.targetVersion,
      });
      onDuplicateProjectSuccess(data);
    },
    onError: (error, _variables, context) => {
      if (context?.previousList) {
        utils.project.list.setData(undefined, context.previousList);
      }
      toast.error("Failed to duplicate project", {
        id: duplicateProjectToastId,
        description: error.message,
      });
    },
  });

  const setPublicPreviewEnabledMutation =
    trpc.project.setPublicPreviewEnabled.useMutation({
      onSuccess: (data) => {
        toast.success(
          data.publicPreviewEnabled
            ? "Preview URL enabled"
            : "Preview URL disabled",
        );
        utils.project.list.invalidate();
        utils.project.getExternalPreviewStatus.invalidate({
          slug: projectSlug,
          version: selectedVersion,
        });
      },
      onError: (error) => {
        toast.error("Failed to update preview URL setting", {
          description: error.message,
        });
      },
    });

  return {
    deleteTagMutation,
    duplicateProjectMutation,
    regenerateThumbnailMutation,
    renameSlugMutation,
    renameTagMutation,
    setCurrentVersionMutation,
    setPublicPreviewEnabledMutation,
    setStatusMutation,
    setTagColorMutation,
    updateTagsMutation,
    updateTitleMutation,
  };
}
