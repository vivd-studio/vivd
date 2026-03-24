import { useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useOpencodeChat } from "@/features/opencodeChat";
import { formatDollarsAsCredits } from "@vivd/shared";
import { useChatContext } from "./ChatContext";
import { getSessionContextMetrics } from "./sessionContextMetrics";

export function SessionContextIndicator() {
  const [open, setOpen] = useState(false);
  const { selectedSessionId, availableModels } = useChatContext();
  const { selectedMessages } = useOpencodeChat();

  const metrics = useMemo(
    () => getSessionContextMetrics(selectedMessages, availableModels),
    [availableModels, selectedMessages],
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
              size="icon"
              onClick={() => setOpen(true)}
              aria-label="View context usage"
              data-testid="session-context-usage-button"
              className="h-8 w-8 rounded-full border border-border/60 bg-background/90 shadow-sm hover:bg-muted/80"
            >
              <ContextUsageRing percentage={usage} />
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
                      {metrics.context.usage != null
                        ? `${metrics.context.usage}%`
                        : "N/A"}
                    </span>
                    <span className="text-muted-foreground">usage</span>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">
                  No token usage recorded yet.
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">
                  {formatDollarsAsCredits(metrics.totalCost)}
                </span>
                <span className="text-muted-foreground">credits</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Context Usage</DialogTitle>
            <DialogDescription>
              Based on the latest assistant response with token accounting.
            </DialogDescription>
          </DialogHeader>

          {metrics.context ? (
            <div className="space-y-5">
              <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-muted/25 px-4 py-3">
                <ContextUsageRing percentage={usage} size={52} strokeWidth={4} />
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-foreground">
                    {metrics.context.usage != null
                      ? `${metrics.context.usage}% used`
                      : "Usage unavailable"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatNumber(metrics.context.total)} total tokens
                    {metrics.context.limit
                      ? ` of ${formatNumber(metrics.context.limit)}`
                      : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {metrics.context.providerLabel} · {metrics.context.modelLabel}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard
                  label="Provider"
                  value={metrics.context.providerLabel}
                />
                <StatCard label="Model" value={metrics.context.modelLabel} />
                <StatCard
                  label="Context Limit"
                  value={formatNumber(metrics.context.limit)}
                />
                <StatCard
                  label="Input Limit"
                  value={formatNumber(metrics.context.inputLimit)}
                />
                <StatCard
                  label="Total Tokens"
                  value={formatNumber(metrics.context.total)}
                />
                <StatCard
                  label="Session Credits"
                  value={formatDollarsAsCredits(metrics.totalCost)}
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
                  label="Cache Tokens"
                  value={`${formatNumber(metrics.context.cacheRead)} / ${formatNumber(
                    metrics.context.cacheWrite,
                  )}`}
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
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
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
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
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
      ? "text-destructive"
      : clamped >= 70
        ? "text-amber-500"
        : "text-emerald-500";

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
          className="text-border/60"
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
