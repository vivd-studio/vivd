import {
  Activity,
  TrendingUp,
  Coins,
  Image as ImageIcon,
} from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-green-600" />
            Usage Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <LoadingSpinner message="Loading usage..." />
        </CardContent>
      </Card>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-green-600" />
          Usage Statistics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Usage Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Daily Credits */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Daily Credits
              </span>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {formatCredits(usageStatus.usage.daily.current)}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>of {formatCredits(usageStatus.usage.daily.limit)}</span>
                <span>
                  {Math.round(usageStatus.usage.daily.percentage * 100)}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usageStatus.usage.daily.percentage >= 1
                      ? "bg-destructive"
                      : usageStatus.usage.daily.percentage >= 0.8
                        ? "bg-yellow-500"
                        : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      usageStatus.usage.daily.percentage * 100,
                      100,
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Resets: {formatDate(usageStatus.nextReset?.daily)}
            </div>
          </div>

          {/* Weekly Credits */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Weekly Credits
              </span>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {formatCredits(usageStatus.usage.weekly.current)}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>of {formatCredits(usageStatus.usage.weekly.limit)}</span>
                <span>
                  {Math.round(usageStatus.usage.weekly.percentage * 100)}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usageStatus.usage.weekly.percentage >= 1
                      ? "bg-destructive"
                      : usageStatus.usage.weekly.percentage >= 0.8
                        ? "bg-yellow-500"
                        : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      usageStatus.usage.weekly.percentage * 100,
                      100,
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Resets: {formatDate(usageStatus.nextReset?.weekly)}
            </div>
          </div>

          {/* Monthly Credits */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Monthly Credits
              </span>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {formatCredits(usageStatus.usage.monthly.current)}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>of {formatCredits(usageStatus.usage.monthly.limit)}</span>
                <span>
                  {Math.round(usageStatus.usage.monthly.percentage * 100)}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usageStatus.usage.monthly.percentage >= 1
                      ? "bg-destructive"
                      : usageStatus.usage.monthly.percentage >= 0.8
                        ? "bg-yellow-500"
                        : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      usageStatus.usage.monthly.percentage * 100,
                      100,
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Resets: {formatDate(usageStatus.nextReset?.monthly)}
            </div>
          </div>

          {/* Image Generations */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Image Generations
              </span>
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {usageStatus.usage.imageGen.current}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>of {usageStatus.usage.imageGen.limit} this month</span>
                <span>
                  {Math.round(usageStatus.usage.imageGen.percentage * 100)}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usageStatus.usage.imageGen.percentage >= 1
                      ? "bg-destructive"
                      : usageStatus.usage.imageGen.percentage >= 0.8
                        ? "bg-yellow-500"
                        : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      usageStatus.usage.imageGen.percentage * 100,
                      100,
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Resets: {formatDate(usageStatus.nextReset?.monthly)}
            </div>
          </div>
        </div>

        {/* Warnings */}
        {usageStatus.warnings.length > 0 && (
          <div
            className={`rounded-lg p-4 ${
              usageStatus.blocked
                ? "bg-destructive/10 border-destructive/50"
                : "bg-yellow-500/10 border-yellow-500/50"
            } border`}
          >
            <div
              className={`font-medium text-sm ${
                usageStatus.blocked
                  ? "text-destructive"
                  : "text-yellow-700 dark:text-yellow-500"
              }`}
            >
              {usageStatus.blocked ? "Usage Blocked" : "Usage Warnings"}
            </div>
            <ul className="mt-2 space-y-1">
              {usageStatus.warnings.map((warning, i) => (
                <li key={i} className="text-sm text-muted-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
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
                  <div className="w-full bg-muted rounded-t flex-1 flex items-end">
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
      </CardContent>
    </Card>
  );
}
