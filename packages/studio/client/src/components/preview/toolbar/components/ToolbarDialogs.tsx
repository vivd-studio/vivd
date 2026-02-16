import {
  VersionHistoryPanel,
} from "@/components/projects/versioning";
import { PublishDialog } from "@/components/publish/PublishDialog";

interface ToolbarDialogsProps {
  projectSlug: string | undefined;
  selectedVersion: number;
  historyPanelOpen: boolean;
  setHistoryPanelOpen: (value: boolean) => void;
  publishDialogOpen: boolean;
  setPublishDialogOpen: (value: boolean) => void;
  handleLoadVersion: (commitHash: string) => void;
  isLoadingVersion: boolean;
  loadingVersionHash: string | null;
  handleRefresh: () => void;
  onPublished: () => void;
}

export function ToolbarDialogs({
  projectSlug,
  selectedVersion,
  historyPanelOpen,
  setHistoryPanelOpen,
  publishDialogOpen,
  setPublishDialogOpen,
  handleLoadVersion,
  isLoadingVersion,
  loadingVersionHash,
  handleRefresh,
  onPublished,
}: ToolbarDialogsProps) {
  if (!projectSlug) return null;

  return (
    <>
      <VersionHistoryPanel
        open={historyPanelOpen}
        onOpenChange={setHistoryPanelOpen}
        projectSlug={projectSlug}
        version={selectedVersion}
        onLoadVersion={handleLoadVersion}
        isLoadingVersion={isLoadingVersion}
        loadingVersionHash={loadingVersionHash}
        onRefresh={handleRefresh}
      />

      <PublishDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        projectSlug={projectSlug}
        version={selectedVersion}
        onPublished={onPublished}
      />
    </>
  );
}
