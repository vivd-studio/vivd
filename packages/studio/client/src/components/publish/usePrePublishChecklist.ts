import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ChecklistItem, PrePublishChecklist } from "./types";
import { CHECKLIST_PENDING_NOTE_MARKER } from "./constants";

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
  const [liveChecklistRunBaselineRunAt, setLiveChecklistRunBaselineRunAt] =
    useState<string | null>(null);

  const runChecklistMutation = trpc.agent.runPrePublishChecklist.useMutation({
    onSuccess: (data) => {
      setIsLiveChecklistRun(false);
      setLiveChecklistRunBaselineRunAt(null);
      toast.success(
        `Checklist complete: ${data.checklist.summary.passed}/${data.checklist.items.length} passed`
      );
      void refetchChecklist();
    },
    onError: (error) => {
      setIsLiveChecklistRun(false);
      setLiveChecklistRunBaselineRunAt(null);
      toast.error(`Failed to run checklist: ${error.message}`);
    },
  });
  const { mutate: runChecklist } = runChecklistMutation;

  const {
    data: checklistData,
    isLoading: isLoadingChecklist,
    refetch: refetchChecklist,
  } = trpc.agent.getPrePublishChecklist.useQuery(
    { projectSlug, version },
    {
      enabled: dialogOpen && !!projectSlug,
      refetchInterval:
        isLiveChecklistRun || runChecklistMutation.isPending ? 1000 : false,
      refetchIntervalInBackground: true,
    }
  );

  const checklist: PrePublishChecklist | null = checklistData?.checklist ?? null;
  const hasPendingChecklistItems =
    checklist?.items.some(
      (item) => item.note === CHECKLIST_PENDING_NOTE_MARKER
    ) ?? false;
  const hasChangesSinceCheck =
    (checklistData?.hasChangesSinceCheck ?? true) || hasPendingChecklistItems;

  const [fixingItemId, setFixingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!dialogOpen) {
      setFixingItemId(null);
      setIsLiveChecklistRun(false);
      setLiveChecklistRunBaselineRunAt(null);
    }
  }, [dialogOpen]);

  useEffect(() => {
    if (!isLiveChecklistRun || !checklist || hasPendingChecklistItems) return;
    if (
      liveChecklistRunBaselineRunAt &&
      checklist.runAt === liveChecklistRunBaselineRunAt
    ) {
      return;
    }
    setIsLiveChecklistRun(false);
    setLiveChecklistRunBaselineRunAt(null);
  }, [
    checklist,
    hasPendingChecklistItems,
    isLiveChecklistRun,
    liveChecklistRunBaselineRunAt,
  ]);

  useEffect(() => {
    if (!isLiveChecklistRun) return;
    const timeout = window.setTimeout(() => {
      setIsLiveChecklistRun(false);
      setLiveChecklistRunBaselineRunAt(null);
    }, 180_000);
    return () => window.clearTimeout(timeout);
  }, [isLiveChecklistRun]);

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
    setLiveChecklistRunBaselineRunAt(checklist?.runAt ?? null);
    setIsLiveChecklistRun(true);
    void refetchChecklist();
    runChecklist({ projectSlug, version });
  }, [checklist?.runAt, projectSlug, refetchChecklist, runChecklist, version]);

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
    isRunningChecklist: isLiveChecklistRun || runChecklistMutation.isPending,
    fixChecklistItem: handleFixItem,
    fixingItemId,
  };
}
