import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  CalloutDescription,
  CalloutTitle,
  InteractiveSurfaceButton,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  StatusPill,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@vivd/ui";

import {
  AlertTriangle,
  ChevronDown,
  Circle,
  ClipboardCheck,
  Loader2,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ChecklistItem, PrePublishChecklist } from "./types";
import {
  CHECKLIST_PENDING_NOTE_MARKER,
  CHECKLIST_STATUS_CONFIG,
  PREVIEW_CHECKLIST_ITEMS,
} from "./constants";
import { cn } from "@/lib/utils";

interface PrePublishChecklistProps {
  dialogOpen: boolean;
  checklist: PrePublishChecklist | null;
  hasChangesSinceCheck: boolean;
  isLoading: boolean;
  isRunning: boolean;
  onRun: () => void;
  onFixItem: (item: ChecklistItem) => void;
  fixingItemId: string | null;
}

export function PrePublishChecklist({
  dialogOpen,
  checklist,
  hasChangesSinceCheck,
  isLoading,
  isRunning,
  onRun,
  onFixItem,
  fixingItemId,
}: PrePublishChecklistProps) {
  const [checklistOpen, setChecklistOpen] = useState(true);

  useEffect(() => {
    if (!dialogOpen) {
      setChecklistOpen(true);
    }
  }, [dialogOpen]);

  const checklistProgress = useMemo(() => {
    if (!checklist) return null;
    const total = checklist.items.length;
    const completed = checklist.items.filter(
      (item) => item.note !== CHECKLIST_PENDING_NOTE_MARKER,
    ).length;
    return { completed, total };
  }, [checklist]);

  const checklistBadge = useMemo(() => {
    if (isRunning) {
      if (checklistProgress) {
        return {
          variant: "secondary" as const,
          text: `Checking ${checklistProgress.completed}/${checklistProgress.total}`,
        };
      }
      return { variant: "secondary" as const, text: "Running..." };
    }

    if (!checklist || !checklistProgress) return null;
    if (checklistProgress.completed < checklistProgress.total) {
      return {
        variant: "secondary" as const,
        text: `Incomplete ${checklistProgress.completed}/${checklistProgress.total}`,
      };
    }
    const { passed, failed, warnings } = checklist.summary;
    const total = checklistProgress.total;
    if (failed > 0) {
      return { variant: "destructive" as const, text: `${failed} issues` };
    }
    if (warnings > 0) {
      return { variant: "secondary" as const, text: `${warnings} warnings` };
    }
    return { variant: "default" as const, text: `${passed}/${total} passed` };
  }, [checklist, checklistProgress, isRunning]);

  const handleRun = () => {
    setChecklistOpen(true);
    onRun();
  };

  const handleFixItem = (item: ChecklistItem) => {
    setChecklistOpen(true);
    onFixItem(item);
  };

  return (
    <Collapsible open={checklistOpen} onOpenChange={setChecklistOpen}>
      <CollapsibleTrigger asChild>
        <InteractiveSurfaceButton
          variant="choice"
          className={cn(
            "flex w-full items-center justify-between rounded-lg p-3 text-left",
            !checklist &&
              "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15",
          )}
        >
          <div className="flex items-center gap-2">
            <ClipboardCheck
              className={`h-4 w-4 ${
                !checklist ? "text-amber-600 dark:text-amber-400" : ""
              }`}
            />
            <span className="text-sm font-medium">Pre-Publish Checklist</span>
            {checklistBadge ? (
              <Badge variant={checklistBadge.variant} className="text-xs">
                {checklistBadge.text}
              </Badge>
            ) : (
              <StatusPill tone="warn">Not run</StatusPill>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${
              checklistOpen ? "rotate-180" : ""
            }`}
          />
        </InteractiveSurfaceButton>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 space-y-2">
        {isRunning && (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-sm font-medium">
                Running production checks...
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {checklistProgress
                  ? `${checklistProgress.completed}/${checklistProgress.total} checks updated live`
                  : "Preparing live checklist updates..."}
              </p>
            </div>
          </div>
        )}

        {checklist ? (
          <>
            <p className="text-xs text-muted-foreground px-1">
              Last run {formatDistanceToNow(new Date(checklist.runAt))} ago
            </p>
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-surface-sunken [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50">
              {checklist.items.map((item) => {
                const isPending = item.note === CHECKLIST_PENDING_NOTE_MARKER;
                const isActivelyChecking = isPending && isRunning;
                const config = isActivelyChecking
                  ? {
                      color: "text-sky-600 dark:text-sky-400",
                      bgColor: "border-primary/30 bg-primary/10",
                    }
                  : isPending
                    ? {
                        color: "text-amber-600 dark:text-amber-400",
                        bgColor: "border-amber-500/30 bg-amber-500/10",
                      }
                    : CHECKLIST_STATUS_CONFIG[item.status];
                const Icon = isActivelyChecking
                  ? Loader2
                  : isPending
                    ? AlertTriangle
                    : CHECKLIST_STATUS_CONFIG[item.status].icon;
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-2 p-2 rounded-md border text-sm ${config.bgColor}`}
                  >
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${config.color} ${
                        isActivelyChecking ? "animate-spin" : ""
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs flex items-center gap-1.5">
                        {item.label}
                        {isActivelyChecking && (
                          <StatusPill tone="info" className="text-[10px]">
                            Checking
                          </StatusPill>
                        )}
                        {isPending && !isActivelyChecking && (
                          <StatusPill tone="warn" className="text-[10px]">
                            Pending
                          </StatusPill>
                        )}
                        {item.status === "fixed" && (
                          <StatusPill tone="info" className="text-[10px]">
                            Fixed
                          </StatusPill>
                        )}
                      </p>
                      {isPending ? (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isActivelyChecking
                            ? "Agent is currently checking this test point..."
                            : "Not completed in the last run. Re-run checks to continue."}
                        </p>
                      ) : item.note ? (
                        <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">
                          {item.note}
                        </p>
                      ) : null}
                    </div>
                    {!isRunning &&
                      (item.status === "fail" || item.status === "warning") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleFixItem(item)}
                          disabled={fixingItemId !== null}
                          className="shrink-0 h-6 px-2 text-xs hover:bg-primary/10"
                        >
                          {fixingItemId === item.id ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Wrench className="w-3 h-3 mr-1" />
                          )}
                          {fixingItemId === item.id ? "Fixing..." : "Fix"}
                        </Button>
                      )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRun}
                      disabled={
                        isRunning ||
                        fixingItemId !== null ||
                        !hasChangesSinceCheck
                      }
                      className={`w-full ${
                        !hasChangesSinceCheck
                          ? "opacity-50 cursor-not-allowed"
                          : checklist.summary.failed > 0 ||
                              checklist.summary.warnings > 0
                            ? "border-amber-500/50 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                            : ""
                      }`}
                    >
                      <RefreshCw className="w-3 h-3 mr-2" />
                      Re-run Checks
                    </Button>
                  </span>
                </TooltipTrigger>
                {!hasChangesSinceCheck && (
                  <TooltipContent>
                    <p>No changes since last check</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </>
        ) : isRunning ? (
          <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-surface-sunken [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50">
            {PREVIEW_CHECKLIST_ITEMS.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 p-2 text-sm"
              >
                <Loader2 className="w-4 h-4 mt-0.5 shrink-0 text-sky-600 dark:text-sky-400 animate-spin" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-xs">{item.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Waiting for first update...
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Callout
            tone="warn"
            icon={<AlertTriangle />}
            className="[&>div]:gap-3"
          >
            <div>
              <CalloutTitle>Verify production readiness</CalloutTitle>
              <CalloutDescription className="mt-0.5">
                Run automated checks before publishing to catch common issues
              </CalloutDescription>
            </div>
            <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-surface-sunken [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50">
              {PREVIEW_CHECKLIST_ITEMS.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 py-1.5 px-2 text-xs text-muted-foreground"
                >
                  <Circle className="w-3 h-3 shrink-0 text-muted-foreground/50" />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <Button
              onClick={handleRun}
              disabled={isRunning || isLoading}
              size="sm"
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
            >
              <ClipboardCheck className="w-4 h-4 mr-2" />
              Run Pre-Publish Checks
            </Button>
          </Callout>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
