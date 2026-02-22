import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BarChart3, RefreshCw } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { ROUTES } from "@/app/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";

type AnalyticsRange = 7 | 30;
type AnalyticsSummary = RouterOutputs["plugins"]["analyticsSummary"];

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(2);
}

function formatDeviceLabel(value: string): string {
  switch (value) {
    case "desktop":
      return "Desktop";
    case "mobile":
      return "Mobile";
    case "tablet":
      return "Tablet";
    case "bot":
      return "Bot";
    default:
      return "Unknown";
  }
}

function MetricCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
    </section>
  );
}

export default function ProjectAnalytics() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const slug = projectSlug || "";
  const [rangeDays, setRangeDays] = useState<AnalyticsRange>(30);

  const analyticsInfoQuery = trpc.plugins.analyticsInfo.useQuery(
    { slug },
    { enabled: !!projectSlug },
  );
  const analyticsEnabled = !!analyticsInfoQuery.data?.enabled;

  const analyticsSummaryQuery = trpc.plugins.analyticsSummary.useQuery(
    { slug, rangeDays },
    { enabled: !!projectSlug && analyticsEnabled },
  );
  const analyticsSummary: AnalyticsSummary | undefined = analyticsSummaryQuery.data;

  const dailyRows = useMemo(() => {
    if (!analyticsSummary) return [];
    return analyticsSummary.daily.map((row, index) => ({
      date: row.date,
      pageviews: row.pageviews,
      events: row.events,
      sessions: row.uniqueSessions,
      visitors: row.uniqueVisitors,
      submissions: analyticsSummary.contactForm.daily[index]?.submissions ?? 0,
    }));
  }, [analyticsSummary]);

  const peakPageviews = Math.max(1, ...dailyRows.map((row) => row.pageviews));
  const peakSubmissions = Math.max(1, ...dailyRows.map((row) => row.submissions));

  const handleRefresh = () => {
    const refetches: Array<Promise<unknown>> = [analyticsInfoQuery.refetch()];
    if (analyticsEnabled) {
      refetches.push(analyticsSummaryQuery.refetch());
    }
    void Promise.all(refetches);
  };

  if (!projectSlug) {
    return <div className="text-sm text-muted-foreground">Missing project slug.</div>;
  }

  return (
    <SettingsPageShell
      title="Analytics"
      description={`Business analytics dashboard for ${projectSlug}.`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to={ROUTES.PROJECT(projectSlug)}>Back to project</Link>
          </Button>
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={analyticsInfoQuery.isLoading || analyticsSummaryQuery.isLoading}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>
      }
    >
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Website + Lead Analytics</CardTitle>
            </div>
            <Badge variant={analyticsEnabled ? "default" : "secondary"}>
              {analyticsEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {analyticsInfoQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load analytics settings: {analyticsInfoQuery.error.message}
            </div>
          ) : null}

          {!analyticsEnabled ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Analytics is not enabled for this project. Ask a super-admin to enable
              Analytics in Super Admin → Plugins.
            </div>
          ) : null}

          {analyticsEnabled ? (
            <>
              {analyticsSummaryQuery.error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Failed to load analytics data: {analyticsSummaryQuery.error.message}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {analyticsSummary
                    ? `${analyticsSummary.rangeStart} to ${analyticsSummary.rangeEnd}`
                    : ""}
                </p>
                <div className="inline-flex rounded-md border p-0.5">
                  <Button
                    size="sm"
                    variant={rangeDays === 7 ? "default" : "ghost"}
                    onClick={() => setRangeDays(7)}
                    disabled={analyticsSummaryQuery.isFetching}
                  >
                    7 days
                  </Button>
                  <Button
                    size="sm"
                    variant={rangeDays === 30 ? "default" : "ghost"}
                    onClick={() => setRangeDays(30)}
                    disabled={analyticsSummaryQuery.isFetching}
                  >
                    30 days
                  </Button>
                </div>
              </div>

              {analyticsSummaryQuery.isLoading ? (
                <div className="rounded-md border bg-muted/20 px-3 py-8 text-sm text-muted-foreground">
                  Loading dashboard...
                </div>
              ) : analyticsSummary ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
                    <MetricCard
                      label="Pageviews"
                      value={formatInteger(analyticsSummary.totals.pageviews)}
                    />
                    <MetricCard
                      label="Unique visitors"
                      value={formatInteger(analyticsSummary.totals.uniqueVisitors)}
                    />
                    <MetricCard
                      label="Sessions"
                      value={formatInteger(analyticsSummary.totals.uniqueSessions)}
                    />
                    <MetricCard
                      label="Pages / session"
                      value={formatRatio(analyticsSummary.totals.avgPagesPerSession)}
                    />
                    <MetricCard
                      label="Contact submissions"
                      value={formatInteger(analyticsSummary.contactForm.submissions)}
                      subtitle={
                        analyticsSummary.contactForm.enabled
                          ? "Contact Form plugin active"
                          : "Contact Form plugin currently disabled"
                      }
                    />
                    <MetricCard
                      label="Submit rate"
                      value={formatPercent(analyticsSummary.contactForm.conversionRatePct)}
                      subtitle="Submissions / pageviews"
                    />
                  </div>

                  <section className="rounded-lg border bg-card p-4 space-y-3">
                    <h3 className="text-sm font-medium">Daily business trend</h3>
                    <p className="text-xs text-muted-foreground">
                      Compare website traffic with form submissions by day.
                    </p>
                    <div className="space-y-3">
                      {dailyRows.map((row) => (
                        <div key={row.date} className="rounded-md border p-3">
                          <div className="mb-2 flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{row.date}</span>
                            <span>
                              {formatInteger(row.pageviews)} pageviews ·{" "}
                              {formatInteger(row.submissions)} submissions
                            </span>
                          </div>
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span>Pageviews</span>
                                <span>{formatInteger(row.pageviews)}</span>
                              </div>
                              <Progress
                                value={Math.round((row.pageviews / peakPageviews) * 100)}
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span>Submissions</span>
                                <span>{formatInteger(row.submissions)}</span>
                              </div>
                              <Progress
                                value={Math.round((row.submissions / peakSubmissions) * 100)}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <section className="rounded-lg border bg-card p-4 space-y-3">
                      <h3 className="text-sm font-medium">Top pages</h3>
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="px-3 py-2 font-medium">Path</th>
                              <th className="px-3 py-2 font-medium">Pageviews</th>
                              <th className="px-3 py-2 font-medium">Visitors</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.topPages.length > 0 ? (
                              analyticsSummary.topPages.map((row) => (
                                <tr key={row.path} className="border-t">
                                  <td className="px-3 py-2 text-xs break-all">{row.path}</td>
                                  <td className="px-3 py-2">{formatInteger(row.pageviews)}</td>
                                  <td className="px-3 py-2">
                                    {formatInteger(row.uniqueVisitors)}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                                  No pageview data in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="rounded-lg border bg-card p-4 space-y-3">
                      <h3 className="text-sm font-medium">Top referrers</h3>
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="px-3 py-2 font-medium">Referrer host</th>
                              <th className="px-3 py-2 font-medium">Events</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.topReferrers.length > 0 ? (
                              analyticsSummary.topReferrers.map((row) => (
                                <tr key={row.referrerHost} className="border-t">
                                  <td className="px-3 py-2 text-xs break-all">
                                    {row.referrerHost}
                                  </td>
                                  <td className="px-3 py-2">{formatInteger(row.events)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={2}>
                                  No referrer data in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <section className="rounded-lg border bg-card p-4 space-y-3">
                      <h3 className="text-sm font-medium">Device split</h3>
                      {analyticsSummary.devices.length > 0 ? (
                        <div className="space-y-3">
                          {analyticsSummary.devices.map((row) => (
                            <div key={row.deviceType} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">
                                  {formatDeviceLabel(row.deviceType)}
                                </span>
                                <span>
                                  {formatInteger(row.events)} ({formatPercent(row.share)})
                                </span>
                              </div>
                              <Progress value={Math.min(100, Math.max(0, row.share))} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No device data in this range.
                        </p>
                      )}
                    </section>

                    <section className="rounded-lg border bg-card p-4 space-y-3">
                      <h3 className="text-sm font-medium">Contact source hosts</h3>
                      <p className="text-xs text-muted-foreground">
                        Unique source hosts:{" "}
                        {formatInteger(analyticsSummary.contactForm.uniqueSourceHosts)}
                      </p>
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="px-3 py-2 font-medium">Source host</th>
                              <th className="px-3 py-2 font-medium">Submissions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.contactForm.topSourceHosts.length > 0 ? (
                              analyticsSummary.contactForm.topSourceHosts.map((row) => (
                                <tr key={row.sourceHost} className="border-t">
                                  <td className="px-3 py-2 text-xs break-all">
                                    {row.sourceHost}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatInteger(row.submissions)}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={2}>
                                  No contact submissions in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
}
