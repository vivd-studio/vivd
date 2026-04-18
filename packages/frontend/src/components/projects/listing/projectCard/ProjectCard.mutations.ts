import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface UseProjectCardMutationsArgs {
  projectSlug: string;
  selectedVersion: number;
  onRenameSuccess: () => void;
  onTitleUpdateSuccess: (title: string) => void;
}

export function useProjectCardMutations({
  projectSlug,
  selectedVersion,
  onRenameSuccess,
  onTitleUpdateSuccess,
}: UseProjectCardMutationsArgs) {
  const utils = trpc.useUtils();

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
