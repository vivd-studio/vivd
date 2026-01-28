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
  const {
    data: checklistData,
    isLoading: isLoadingChecklist,
    refetch: refetchChecklist,
  } = trpc.agent.getPrePublishChecklist.useQuery(
    { projectSlug, version },
    { enabled: dialogOpen && !!projectSlug }
  );

  const checklist: PrePublishChecklist | null = checklistData?.checklist ?? null;
  const hasChangesSinceCheck = checklistData?.hasChangesSinceCheck ?? true;

  const [fixingItemId, setFixingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!dialogOpen) {
      setFixingItemId(null);
    }
  }, [dialogOpen]);

  const { mutate: runChecklist, isPending: isRunningChecklist } =
    trpc.agent.runPrePublishChecklist.useMutation({
      onSuccess: (data) => {
        toast.success(
          `Checklist complete: ${data.checklist.summary.passed}/${data.checklist.items.length} passed`
        );
        void refetchChecklist();
      },
      onError: (error) => {
        toast.error(`Failed to run checklist: ${error.message}`);
      },
    });

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
    runChecklist({ projectSlug, version });
  }, [projectSlug, runChecklist, version]);

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
    isRunningChecklist,
    fixChecklistItem: handleFixItem,
    fixingItemId,
  };
}

