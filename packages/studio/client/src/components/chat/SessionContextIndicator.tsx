import { useMemo, useState } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@vivd/ui";

import { cn } from "@/lib/utils";
import { useOpencodeChat } from "@/features/opencodeChat";
import { formatDollarsAsCredits } from "@vivd/shared";
import { useChatContext } from "./ChatContext";
import { getSessionContextMetrics } from "./sessionContextMetrics";

export function SessionContextIndicator() {
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const {
    selectedSessionId,
    availableModels,
    softContextLimitTokens,
  } = useChatContext();
  const { selectedMessages } = useOpencodeChat();

  const metrics = useMemo(
    () =>
      getSessionContextMetrics(selectedMessages, availableModels, {
        softContextLimitTokens,
      }),
    [availableModels, selectedMessages, softContextLimitTokens],
  );
  const usage = metrics.context?.usage ?? 0;

  if (!selectedSessionId) {
    return null;
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(true)}
              aria-label="View context usage"
              data-testid="session-context-usage-button"
              className="h-9 min-w-[54px] rounded-full border border-border/70 bg-background/92 px-2.5 shadow-sm backdrop-blur-sm hover:bg-muted/85 dark:border-white/15 dark:bg-background/95 dark:shadow-[0_10px_30px_rgba(0,0,0,0.45)] dark:hover:border-white/25 dark:hover:bg-muted/75"
            >
              <div className="flex items-center gap-1.5">
                <ContextUsageRing percentage={usage} size={16} />
                <span className="text-xs font-semibold leading-none text-foreground/90">
                  {metrics.context?.usage != null ? `${metrics.context.usage}%` : "Ctx"}
                </span>
              </div>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-52">
            <div className="space-y-1">
              {metrics.context ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {formatNumber(metrics.context.total)}
                    </span>
                    <span className="text-muted-foreground">tokens</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {formatDollarsAsCredits(metrics.totalCost)}
                    </span>
                    <span className="text-muted-foreground">credits</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {formatNumber(softContextLimitTokens)}
                    </span>
                    <span className="text-muted-foreground">compaction limit</span>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">
                  No token usage recorded yet.
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setDetailsOpen(false);
          }
        }}
      >
        <DialogContent className="w-[calc(100%-1rem)] max-w-xl max-h-[calc(100dvh-1rem)] flex flex-col overflow-hidden sm:w-full sm:max-h-[90vh]">
          <DialogHeader className="pr-8">
            <DialogTitle>Context Usage</DialogTitle>
            <DialogDescription>
              Vivd starts compacting long sessions around{" "}
              {formatNumber(softContextLimitTokens)} tokens,
              before the model&apos;s full window.
            </DialogDescription>
          </DialogHeader>

          {metrics.context ? (
            <div className="flex-1 overflow-y-auto pr-1">
              <div className="space-y-5 pb-1">
                <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-muted/25 px-4 py-3">
                  <ContextUsageRing percentage={usage} size={52} strokeWidth={4} />
                  <div className="min-w-0">
                    <div className="text-xl font-semibold text-foreground">
                      {metrics.context.usage != null
                        ? `${metrics.context.usage}% of working limit`
                        : "Usage unavailable"}
                    </div>
                    <div className="text-base text-muted-foreground">
                      {formatNumber(metrics.context.total)} total tokens recorded
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard
                    label="Total Tokens"
                    value={formatNumber(metrics.context.total)}
                  />
                  <StatCard
                    label="Session Credits"
                    value={formatDollarsAsCredits(metrics.totalCost)}
                  />
                  <StatCard
                    label="Compaction Limit"
                    value={formatNumber(softContextLimitTokens)}
                  />
                </div>

                <Collapsible
                  open={detailsOpen}
                  onOpenChange={setDetailsOpen}
                  className="rounded-lg border border-border/45 bg-muted/10"
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      aria-label={detailsOpen ? "Hide details" : "Show details"}
                      data-testid="session-context-details-toggle"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground/80"
                    >
                      <span>Details</span>
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-muted-foreground/80 transition-transform",
                          detailsOpen && "rotate-180",
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="overflow-hidden border-t border-border/60 data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
                    <div className="grid gap-3 p-4 sm:grid-cols-2">
                      <StatCard
                        label="Used Model"
                        value={metrics.context.modelLabel}
                      />
                      <StatCard
                        label="Effective Working Limit"
                        value={formatNumber(metrics.context.workingLimit)}
                      />
                      <StatCard
                        label="Model Context Limit"
                        value={formatNumber(metrics.context.limit)}
                      />
                      <StatCard
                        label="Model Input Limit"
                        value={formatNumber(metrics.context.inputLimit)}
                      />
                      <StatCard
                        label="Input Tokens"
                        value={formatNumber(metrics.context.input)}
                      />
                      <StatCard
                        label="Output Tokens"
                        value={formatNumber(metrics.context.output)}
                      />
                      <StatCard
                        label="Reasoning Tokens"
                        value={formatNumber(metrics.context.reasoning)}
                      />
                      <StatCard
                        label="Cache Read"
                        value={formatNumber(metrics.context.cacheRead)}
                      />
                      <StatCard
                        label="Cache Write"
                        value={formatNumber(metrics.context.cacheWrite)}
                      />
                      <StatCard
                        label="Messages"
                        value={formatNumber(metrics.messageCount)}
                      />
                      <StatCard
                        label="User / Assistant"
                        value={`${formatNumber(metrics.userMessageCount)} / ${formatNumber(
                          metrics.assistantMessageCount,
                        )}`}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-4 text-base text-muted-foreground">
              <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                No assistant message with token accounting is available for this
                session yet.
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background px-3 py-2.5">
      <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base font-medium text-foreground">{value}</div>
    </div>
  );
}

function ContextUsageRing({
  percentage,
  size = 18,
  strokeWidth = 2,
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(percentage, 100));
  const offset = circumference - (clamped / 100) * circumference;
  const strokeClass =
    clamped >= 90
      ? "text-destructive dark:text-rose-400"
      : clamped >= 70
        ? "text-amber-500 dark:text-amber-400"
        : "text-emerald-500 dark:text-emerald-400";

  return (
    <div className="relative flex items-center justify-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-border/70 dark:text-white/12"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("transition-[stroke-dashoffset] duration-300", strokeClass)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </div>
  );
}

function formatNumber(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "N/A";
}
