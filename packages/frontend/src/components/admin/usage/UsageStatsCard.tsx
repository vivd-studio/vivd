import {
  Activity,
  TrendingUp,
  Coins,
  Image as ImageIcon,
  AlertTriangle,
} from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import {
  Callout,
  CalloutTitle,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
  Progress,
  StatTile,
  StatTileHelper,
  StatTileLabel,
  StatTileMeta,
  StatTileValue,
} from "@vivd/ui";

import { trpc } from "@/lib/trpc";
import { formatCredits, formatDollarsAsCredits } from "@vivd/shared";
import { SessionUsageTable } from "./SessionUsageTable";
import { FlowUsageTable } from "./FlowUsageTable";

export function UsageStatsCard() {
  const { data: usageStatus, isLoading } = trpc.usage.status.useQuery(
    undefined,
    {
      refetchInterval: 30000,
    },
  );
  const { data: usageHistory } = trpc.usage.history.useQuery({ days: 30 });

  if (isLoading) {
    return (
      <Panel>
        <PanelHeader>
          <PanelTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-green-600" />
            Usage Statistics
          </PanelTitle>
        </PanelHeader>
        <PanelContent className="flex items-center justify-center py-8">
          <LoadingSpinner message="Loading usage..." />
        </PanelContent>
      </Panel>
    );
  }

  if (!usageStatus) {
    return null;
  }

  const formatDate = (date: unknown) => {
    if (!date) return "—";
    try {
      const d = date instanceof Date ? date : new Date(date as string | number);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "—";
    }
  };

  const dailyCosts =
    usageHistory?.reduce(
      (acc, record) => {
        const d = new Date(record.createdAt);
        const dateKey = d.toISOString().split("T")[0];
        acc[dateKey] = (acc[dateKey] || 0) + parseFloat(record.cost);
        return acc;
      },
      {} as Record<string, number>,
    ) || {};

  const last8Days = (() => {
    const today = new Date();
    const days: { date: string; cost: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split("T")[0];
      days.push({ date: dateKey, cost: dailyCosts[dateKey] || 0 });
    }
    return days;
  })();

  const maxDailyCost = Math.max(...last8Days.map((d) => d.cost), 0.01);
  const progressToneClass = (pct: number) => {
    if (pct >= 1) return "[&>div]:bg-destructive";
    if (pct >= 0.8) return "[&>div]:bg-amber-500";
    return "[&>div]:bg-emerald-500";
  };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-green-600" />
          Usage Statistics
        </PanelTitle>
      </PanelHeader>
      <PanelContent className="space-y-6">
        {/* Current Usage Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Daily Credits */}
          <StatTile>
            <StatTileLabel>
              <span>Daily Credits</span>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </StatTileLabel>
            <StatTileValue>
              {formatCredits(usageStatus.usage.daily.current)}
            </StatTileValue>
            <div className="space-y-2">
              <StatTileMeta>
                <span>of {formatCredits(usageStatus.usage.daily.limit)}</span>
                <span>
                  {Math.round(usageStatus.usage.daily.percentage * 100)}%
                </span>
              </StatTileMeta>
              <Progress
                value={Math.min(usageStatus.usage.daily.percentage * 100, 100)}
                className={`h-2 ${progressToneClass(usageStatus.usage.daily.percentage)}`}
              />
            </div>
            <StatTileHelper>
              Resets: {formatDate(usageStatus.nextReset?.daily)}
            </StatTileHelper>
          </StatTile>

          {/* Weekly Credits */}
          <StatTile>
            <StatTileLabel>
              <span>Weekly Credits</span>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </StatTileLabel>
            <StatTileValue>
              {formatCredits(usageStatus.usage.weekly.current)}
            </StatTileValue>
            <div className="space-y-2">
              <StatTileMeta>
                <span>of {formatCredits(usageStatus.usage.weekly.limit)}</span>
                <span>
                  {Math.round(usageStatus.usage.weekly.percentage * 100)}%
                </span>
              </StatTileMeta>
              <Progress
                value={Math.min(usageStatus.usage.weekly.percentage * 100, 100)}
                className={`h-2 ${progressToneClass(usageStatus.usage.weekly.percentage)}`}
              />
            </div>
            <StatTileHelper>
              Resets: {formatDate(usageStatus.nextReset?.weekly)}
            </StatTileHelper>
          </StatTile>

          {/* Monthly Credits */}
          <StatTile>
            <StatTileLabel>
              <span>Monthly Credits</span>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </StatTileLabel>
            <StatTileValue>
              {formatCredits(usageStatus.usage.monthly.current)}
            </StatTileValue>
            <div className="space-y-2">
              <StatTileMeta>
                <span>of {formatCredits(usageStatus.usage.monthly.limit)}</span>
                <span>
                  {Math.round(usageStatus.usage.monthly.percentage * 100)}%
                </span>
              </StatTileMeta>
              <Progress
                value={Math.min(usageStatus.usage.monthly.percentage * 100, 100)}
                className={`h-2 ${progressToneClass(usageStatus.usage.monthly.percentage)}`}
              />
            </div>
            <StatTileHelper>
              Resets: {formatDate(usageStatus.nextReset?.monthly)}
            </StatTileHelper>
          </StatTile>

          {/* Image Generations */}
          <StatTile>
            <StatTileLabel>
              <span>Image Generations</span>
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </StatTileLabel>
            <StatTileValue>
              {usageStatus.usage.imageGen.current}
            </StatTileValue>
            <div className="space-y-2">
              <StatTileMeta>
                <span>of {usageStatus.usage.imageGen.limit} this month</span>
                <span>
                  {Math.round(usageStatus.usage.imageGen.percentage * 100)}%
                </span>
              </StatTileMeta>
              <Progress
                value={Math.min(
                  usageStatus.usage.imageGen.percentage * 100,
                  100,
                )}
                className={`h-2 ${progressToneClass(usageStatus.usage.imageGen.percentage)}`}
              />
            </div>
            <StatTileHelper>
              Resets: {formatDate(usageStatus.nextReset?.monthly)}
            </StatTileHelper>
          </StatTile>
        </div>

        {/* Warnings */}
        {usageStatus.warnings.length > 0 && (
          <Callout tone={usageStatus.blocked ? "danger" : "warn"} icon={<AlertTriangle />}>
            <CalloutTitle>
              {usageStatus.blocked ? "Usage Blocked" : "Usage Warnings"}
            </CalloutTitle>
            <div className="text-sm leading-snug text-muted-foreground">
              <ul className="space-y-1">
              {usageStatus.warnings.map((warning, i) => (
                <li key={i}>
                  {warning}
                </li>
              ))}
              </ul>
            </div>
          </Callout>
        )}

        {/* Last 8 Days Chart */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Last 8 Days
          </h4>
          <div className="flex items-end gap-2 h-32">
            {last8Days.map(({ date, cost }) => {
              const barHeight =
                maxDailyCost > 0 ? (cost / maxDailyCost) * 96 : 0;
              const isToday = date === new Date().toISOString().split("T")[0];
              return (
                <div
                  key={date}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <div
                    className={`text-xs ${
                      isToday
                        ? "text-primary font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {formatDollarsAsCredits(cost)}
                  </div>
                  <div className="flex w-full flex-1 items-end rounded-t bg-surface-sunken">
                    <div
                      className={`w-full rounded-t transition-all ${
                        isToday ? "bg-primary" : "bg-primary/60"
                      }`}
                      style={{
                        height: `${barHeight}px`,
                        minHeight: cost > 0 ? "4px" : "0",
                      }}
                    />
                  </div>
                  <div
                    className={`text-xs truncate w-full text-center ${
                      isToday
                        ? "text-primary font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {(() => {
                      try {
                        const d = new Date(date);
                        if (isNaN(d.getTime())) return "—";
                        const weekday = d.toLocaleDateString(undefined, {
                          weekday: "short",
                        });
                        const dayMonth = d.toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "numeric",
                        });
                        if (isToday) {
                          return `${weekday} (today)`;
                        }
                        return `${weekday} ${dayMonth}`;
                      } catch {
                        return "—";
                      }
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Session Usage (OpenCode) */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Session Usage (OpenCode)
          </h4>
          <SessionUsageTable days={30} />
        </div>

        {/* Flow Usage (OpenRouter Direct) */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Flow Usage (Generation Flows)
          </h4>
          <FlowUsageTable days={30} />
        </div>
      </PanelContent>
    </Panel>
  );
}
