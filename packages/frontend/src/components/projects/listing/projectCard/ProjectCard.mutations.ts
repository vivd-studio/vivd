import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type DuplicateProjectResult = RouterOutputs["project"]["duplicateProject"];

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

  const thumbnailToastId = (slug: string, version: number) =>
    `regenerate-thumbnail-${slug}-v${version}`;

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
      onMutate: (variables) => {
        toast.loading("Regenerating thumbnail", {
          id: thumbnailToastId(variables.slug, variables.version),
          description: `${variables.slug} v${variables.version}`,
        });
      },
      onSuccess: (_data, variables) => {
        toast.success("Thumbnail regenerated", {
          id: thumbnailToastId(variables.slug, variables.version),
          description: `${variables.slug} v${variables.version}`,
        });
        utils.project.list.invalidate();
      },
      onError: (error, variables) => {
        toast.error("Failed to regenerate thumbnail", {
          id: thumbnailToastId(variables.slug, variables.version),
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
    onMutate: (variables) => {
      toast.loading("Duplicating project", {
        id: duplicateProjectToastId,
        description: `Copying ${variables.sourceSlug} v${variables.sourceVersion ?? selectedVersion} as a new project...`,
      });
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
    onError: (error) => {
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
