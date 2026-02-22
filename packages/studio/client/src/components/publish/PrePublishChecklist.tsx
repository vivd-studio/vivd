import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
      (item) => item.note !== CHECKLIST_PENDING_NOTE_MARKER
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
        <button
          className={`flex items-center justify-between w-full p-3 rounded-lg border transition-colors text-left ${
            !checklist
              ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 hover:bg-amber-100/50 dark:hover:bg-amber-900/30"
              : "bg-muted/30 hover:bg-muted/50"
          }`}
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
              <Badge
                variant="secondary"
                className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
              >
                Not run
              </Badge>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${
              checklistOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 space-y-2">
        {isRunning && (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-sm font-medium">Running production checks...</p>
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
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-muted/30 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50">
              {checklist.items.map((item) => {
                const isPending = item.note === CHECKLIST_PENDING_NOTE_MARKER;
                const config = isPending
                  ? {
                      color: "text-sky-600 dark:text-sky-400",
                      bgColor: "bg-sky-50 dark:bg-sky-900/20",
                    }
                  : CHECKLIST_STATUS_CONFIG[item.status];
                const Icon = isPending ? Loader2 : CHECKLIST_STATUS_CONFIG[item.status].icon;
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-2 p-2 rounded-md border text-sm ${config.bgColor}`}
                  >
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${config.color} ${
                        isPending ? "animate-spin" : ""
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs flex items-center gap-1.5">
                        {item.label}
                        {isPending && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
                            Checking
                          </span>
                        )}
                        {item.status === "fixed" && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                            Fixed
                          </span>
                        )}
                      </p>
                      {isPending ? (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isRunning
                            ? "Agent is currently checking this test point..."
                            : "Pending update from the last run."}
                        </p>
                      ) : item.note ? (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
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
                          ? "border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
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
          <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-muted/30 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50">
            {PREVIEW_CHECKLIST_ITEMS.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 p-2 rounded-md border text-sm bg-sky-50 dark:bg-sky-900/20"
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
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Verify production readiness
                </p>
                <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                  Run automated checks before publishing to catch common issues
                </p>
              </div>
            </div>
            <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-muted/30 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50">
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
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
