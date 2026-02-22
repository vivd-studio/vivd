import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ChecklistItem, PrePublishChecklist } from "./types";

interface UsePrePublishChecklistArgs {
  dialogOpen: boolean;
  projectSlug: string;
  version: number;
}

export function usePrePublishChecklist({
  dialogOpen,
  projectSlug,
  version,
}: UsePrePublishChecklistArgs) {
  const [isLiveChecklistRun, setIsLiveChecklistRun] = useState(false);

  const { mutate: runChecklist, isPending: isRunningChecklist } =
    trpc.agent.runPrePublishChecklist.useMutation({
      onSuccess: (data) => {
        setIsLiveChecklistRun(false);
        toast.success(
          `Checklist complete: ${data.checklist.summary.passed}/${data.checklist.items.length} passed`
        );
        void refetchChecklist();
      },
      onError: (error) => {
        setIsLiveChecklistRun(false);
        toast.error(`Failed to run checklist: ${error.message}`);
      },
    });

  const {
    data: checklistData,
    isLoading: isLoadingChecklist,
    refetch: refetchChecklist,
  } = trpc.agent.getPrePublishChecklist.useQuery(
    { projectSlug, version },
    {
      enabled: dialogOpen && !!projectSlug,
      refetchInterval: isLiveChecklistRun ? 1000 : false,
      refetchIntervalInBackground: true,
    }
  );

  const checklist: PrePublishChecklist | null = checklistData?.checklist ?? null;
  const hasChangesSinceCheck = checklistData?.hasChangesSinceCheck ?? true;

  const [fixingItemId, setFixingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!dialogOpen) {
      setFixingItemId(null);
    }
  }, [dialogOpen]);

  const { mutate: mutateFixChecklistItem } =
    trpc.agent.fixChecklistItem.useMutation({
      onSuccess: (_data, variables) => {
        toast.success(`Fixed: ${variables.itemId}`);
        void refetchChecklist();
        setFixingItemId(null);
      },
      onError: (error) => {
        toast.error(`Failed to fix: ${error.message}`);
        setFixingItemId(null);
      },
    });

  const handleRunChecklist = useCallback(() => {
    if (!projectSlug) return;
    setIsLiveChecklistRun(true);
    void refetchChecklist();
    runChecklist({ projectSlug, version });
  }, [projectSlug, refetchChecklist, runChecklist, version]);

  const handleFixItem = useCallback(
    (item: ChecklistItem) => {
      if (!projectSlug) return;
      setFixingItemId(item.id);
      mutateFixChecklistItem({
        projectSlug,
        version,
        itemId: item.id,
        itemLabel: item.label,
        itemStatus: item.status as "fail" | "warning",
        itemNote: item.note,
      });
    },
    [mutateFixChecklistItem, projectSlug, version]
  );

  return {
    checklist,
    hasChangesSinceCheck,
    isLoadingChecklist,
    runChecklist: handleRunChecklist,
    isRunningChecklist: isRunningChecklist || isLiveChecklistRun,
    fixChecklistItem: handleFixItem,
    fixingItemId,
  };
}
