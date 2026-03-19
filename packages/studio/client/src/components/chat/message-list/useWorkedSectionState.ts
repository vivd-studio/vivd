import { type CanonicalTimelineItem } from "@/features/opencodeChat/render/timeline";
import { useCallback, useEffect, useRef, useState } from "react";

export function useWorkedSectionState({
  selectedSessionId,
  timelineItems,
  latestUserMessageId,
  isRunInProgress,
}: {
  selectedSessionId: string | null;
  timelineItems: CanonicalTimelineItem[];
  latestUserMessageId: string | null;
  isRunInProgress: boolean;
}) {
  const [workedOpenRunIds, setWorkedOpenRunIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [workedAutoCollapsedRunIds, setWorkedAutoCollapsedRunIds] = useState<Set<string>>(
    () => new Set(),
  );

  const runStatusRef = useRef<Map<string, "in-progress" | "completed" | "other">>(
    new Map(),
  );
  const runSeenInProgressRef = useRef<Set<string>>(new Set());
  const workedCollapseTimersRef = useRef<Map<string, number>>(new Map());
  const workedAutoCollapsedRunIdsRef = useRef<Set<string>>(new Set());
  const WORKED_AUTO_COLLAPSE_DELAY_MS = 1200;

  useEffect(() => {
    workedAutoCollapsedRunIdsRef.current = workedAutoCollapsedRunIds;
  }, [workedAutoCollapsedRunIds]);

  useEffect(() => {
    return () => {
      workedCollapseTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      workedCollapseTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    runStatusRef.current.clear();
    runSeenInProgressRef.current.clear();
    workedCollapseTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    workedCollapseTimersRef.current.clear();
    setWorkedOpenRunIds(new Set());
    setWorkedAutoCollapsedRunIds(new Set());
  }, [selectedSessionId]);

  useEffect(() => {
    const nextStatusMap = new Map<string, "in-progress" | "completed" | "other">();
    const newlyCompletedRunIds: string[] = [];
    const shouldFreezeWorkedAutoCollapse =
      Boolean(latestUserMessageId) && isRunInProgress;

    for (const item of timelineItems) {
      if (item.kind !== "agent") continue;
      const nextStatus: "in-progress" | "completed" | "other" = item.runInProgress
        ? "in-progress"
        : item.showWorkedSection
          ? "completed"
          : "other";

      nextStatusMap.set(item.runId, nextStatus);
      const previousStatus = runStatusRef.current.get(item.runId);

      if (nextStatus === "in-progress") {
        runSeenInProgressRef.current.add(item.runId);
      }

      const hasBeenActive = runSeenInProgressRef.current.has(item.runId);
      if (
        nextStatus === "completed" &&
        previousStatus !== "completed" &&
        hasBeenActive
      ) {
        newlyCompletedRunIds.push(item.runId);
      }
    }

    runStatusRef.current = nextStatusMap;

    const activeRunIds = new Set(nextStatusMap.keys());
    runSeenInProgressRef.current = new Set(
      [...runSeenInProgressRef.current].filter((runId) => activeRunIds.has(runId)),
    );

    setWorkedOpenRunIds((prev) => {
      const next = new Set([...prev].filter((runId) => activeRunIds.has(runId)));
      let changed = next.size !== prev.size;
      for (const runId of newlyCompletedRunIds) {
        if (workedAutoCollapsedRunIdsRef.current.has(runId)) {
          continue;
        }
        if (!next.has(runId)) {
          next.add(runId);
          changed = true;
        }
      }

      return changed ? next : prev;
    });

    setWorkedAutoCollapsedRunIds((prev) => {
      const next = new Set([...prev].filter((runId) => activeRunIds.has(runId)));
      return next.size === prev.size ? prev : next;
    });

    workedCollapseTimersRef.current.forEach((timerId, runId) => {
      if (shouldFreezeWorkedAutoCollapse) {
        window.clearTimeout(timerId);
        workedCollapseTimersRef.current.delete(runId);
        return;
      }
      if (activeRunIds.has(runId)) return;
      window.clearTimeout(timerId);
      workedCollapseTimersRef.current.delete(runId);
    });

    if (shouldFreezeWorkedAutoCollapse) {
      return;
    }

    for (const runId of newlyCompletedRunIds) {
      if (
        workedCollapseTimersRef.current.has(runId) ||
        workedAutoCollapsedRunIdsRef.current.has(runId)
      ) {
        continue;
      }

      const timerId = window.setTimeout(() => {
        workedCollapseTimersRef.current.delete(runId);
        setWorkedOpenRunIds((prev) => {
          if (!prev.has(runId)) return prev;
          const next = new Set(prev);
          next.delete(runId);
          return next;
        });
        setWorkedAutoCollapsedRunIds((prev) => {
          if (prev.has(runId)) return prev;
          const next = new Set(prev);
          next.add(runId);
          return next;
        });
      }, WORKED_AUTO_COLLAPSE_DELAY_MS);

      workedCollapseTimersRef.current.set(runId, timerId);
    }
  }, [timelineItems, isRunInProgress, latestUserMessageId]);

  const toggleWorkedOpen = useCallback((runId: string) => {
    setWorkedOpenRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);

  return {
    workedOpenRunIds,
    toggleWorkedOpen,
  };
}
