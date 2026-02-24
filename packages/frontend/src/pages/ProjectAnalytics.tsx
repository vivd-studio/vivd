import { type ReactNode, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BarChart3, RefreshCw } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { ROUTES } from "@/app/router";
import { LoadingSpinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";

type AnalyticsRange = 7 | 30;
type AnalyticsSummary = RouterOutputs["plugins"]["analyticsSummary"];
type ComparisonMetric = AnalyticsSummary["comparison"]["totals"]["pageviews"];
type DailyRow = {
  date: string;
  pageviews: number;
  sessions: number;
  visitors: number;
  submissions: number;
  submitRatePct: number;
};

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

function formatSignedInteger(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${new Intl.NumberFormat().format(Math.abs(Math.round(value)))}`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null) return "new";
  if (!Number.isFinite(value) || value === 0) return "0%";
  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${Math.abs(value).toFixed(1)}%`;
}

function formatDeltaSummary(metric: ComparisonMetric): string {
  const delta = formatSignedInteger(metric.delta);
  const deltaPct = formatSignedPercent(metric.deltaPct);
  return `${delta} (${deltaPct})`;
}

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {caption ? <p className="mt-1 text-xs text-muted-foreground">{caption}</p> : null}
    </section>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
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

  const analyticsRangeLabel = rangeDays === 7 ? "Last 7 days" : "Last 30 days";

  const dailyRows = useMemo<DailyRow[]>(() => {
    if (!analyticsSummary) return [];
    const submissionsByDate = new Map(
      analyticsSummary.contactForm.daily.map((row) => [row.date, row.submissions]),
    );

    return analyticsSummary.daily
      .map((row) => {
        const submissions = submissionsByDate.get(row.date) ?? 0;
        return {
          date: row.date,
          pageviews: row.pageviews,
          sessions: row.uniqueSessions,
          visitors: row.uniqueVisitors,
          submissions,
          submitRatePct: row.pageviews > 0 ? (submissions / row.pageviews) * 100 : 0,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [analyticsSummary]);

  const peakPageviews = Math.max(1, ...dailyRows.map((row) => row.pageviews));

  const summaryInsights = useMemo(() => {
    if (!analyticsSummary || dailyRows.length === 0) {
      return {
        activeTrafficDays: 0,
        activeLeadDays: 0,
        avgDailyPageviews: 0,
        avgDailySubmissions: 0,
        topTrafficDay: null as DailyRow | null,
        topLeadDay: null as DailyRow | null,
      };
    }

    let topTrafficDay = dailyRows[0];
    let topLeadDay = dailyRows[0];
    for (const row of dailyRows) {
      if (row.pageviews > topTrafficDay.pageviews) topTrafficDay = row;
      if (row.submissions > topLeadDay.submissions) topLeadDay = row;
    }

    return {
      activeTrafficDays: dailyRows.filter((row) => row.pageviews > 0).length,
      activeLeadDays: dailyRows.filter((row) => row.submissions > 0).length,
      avgDailyPageviews: analyticsSummary.totals.pageviews / dailyRows.length,
      avgDailySubmissions: analyticsSummary.contactForm.submissions / dailyRows.length,
      topTrafficDay,
      topLeadDay,
    };
  }, [analyticsSummary, dailyRows]);

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
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Website + Lead Analytics</CardTitle>
            </div>
            <Badge variant={analyticsEnabled ? "default" : "secondary"}>
              {analyticsEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          {analyticsEnabled ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
              <div>
                <p className="text-xs text-muted-foreground">{analyticsRangeLabel}</p>
                <p className="text-sm font-medium">
                  {analyticsSummary
                    ? `${analyticsSummary.rangeStart} to ${analyticsSummary.rangeEnd}`
                    : "Review business performance across the selected period."}
                </p>
              </div>
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
          ) : null}
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

              {analyticsSummaryQuery.isLoading ? (
                <div className="rounded-md border bg-muted/20 px-3 py-8">
                  <LoadingSpinner message="Loading dashboard..." />
                </div>
              ) : analyticsSummary ? (
                <div className="space-y-6">
                  <SectionCard
                    title="Overview"
                    description="Traffic, audience, and lead metrics for the selected reporting range."
                  >
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                          caption="Higher values often indicate deeper engagement."
                        />
                        <MetricCard
                          label="Contact submissions"
                          value={formatInteger(analyticsSummary.contactForm.submissions)}
                          caption={
                            analyticsSummary.contactForm.enabled
                              ? "Contact Form plugin active."
                              : "Contact Form plugin currently disabled."
                          }
                        />
                        <MetricCard
                          label="Submit rate"
                          value={formatPercent(analyticsSummary.contactForm.conversionRatePct)}
                          caption="Submissions divided by pageviews."
                        />
                      </div>

                      <section className="rounded-lg border bg-muted/20 p-4">
                        <h4 className="text-sm font-medium">At a glance</h4>
                        <div className="mt-3 space-y-2">
                          <InsightRow
                            label="Active traffic days"
                            value={`${formatInteger(summaryInsights.activeTrafficDays)} / ${formatInteger(dailyRows.length)}`}
                          />
                          <InsightRow
                            label="Lead days"
                            value={`${formatInteger(summaryInsights.activeLeadDays)} / ${formatInteger(dailyRows.length)}`}
                          />
                          <InsightRow
                            label="Avg pageviews / day"
                            value={formatRatio(summaryInsights.avgDailyPageviews)}
                          />
                          <InsightRow
                            label="Avg submissions / day"
                            value={formatRatio(summaryInsights.avgDailySubmissions)}
                          />
                          <InsightRow
                            label="Best traffic day"
                            value={
                              summaryInsights.topTrafficDay
                                ? `${formatDateLabel(summaryInsights.topTrafficDay.date)} (${formatInteger(summaryInsights.topTrafficDay.pageviews)})`
                                : "No traffic yet"
                            }
                          />
                          <InsightRow
                            label="Best lead day"
                            value={
                              summaryInsights.topLeadDay
                                ? `${formatDateLabel(summaryInsights.topLeadDay.date)} (${formatInteger(summaryInsights.topLeadDay.submissions)})`
                                : "No submissions yet"
                            }
                          />
                        </div>
                      </section>
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="Period comparison"
                    description={`Compared with the previous ${analyticsSummary.rangeDays}-day window (${analyticsSummary.comparison.previousRangeStart} to ${analyticsSummary.comparison.previousRangeEnd}).`}
                  >
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                          <tr className="text-left">
                            <th className="px-3 py-2 font-medium">Metric</th>
                            <th className="px-3 py-2 font-medium">Current</th>
                            <th className="px-3 py-2 font-medium">Previous</th>
                            <th className="px-3 py-2 font-medium">Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t">
                            <td className="px-3 py-2">Pageviews</td>
                            <td className="px-3 py-2">
                              {formatInteger(analyticsSummary.comparison.totals.pageviews.current)}
                            </td>
                            <td className="px-3 py-2">
                              {formatInteger(analyticsSummary.comparison.totals.pageviews.previous)}
                            </td>
                            <td className="px-3 py-2">
                              {formatDeltaSummary(analyticsSummary.comparison.totals.pageviews)}
                            </td>
                          </tr>
                          <tr className="border-t">
                            <td className="px-3 py-2">Unique visitors</td>
                            <td className="px-3 py-2">
                              {formatInteger(
                                analyticsSummary.comparison.totals.uniqueVisitors.current,
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {formatInteger(
                                analyticsSummary.comparison.totals.uniqueVisitors.previous,
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {formatDeltaSummary(
                                analyticsSummary.comparison.totals.uniqueVisitors,
                              )}
                            </td>
                          </tr>
                          <tr className="border-t">
                            <td className="px-3 py-2">Sessions</td>
                            <td className="px-3 py-2">
                              {formatInteger(
                                analyticsSummary.comparison.totals.uniqueSessions.current,
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {formatInteger(
                                analyticsSummary.comparison.totals.uniqueSessions.previous,
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {formatDeltaSummary(
                                analyticsSummary.comparison.totals.uniqueSessions,
                              )}
                            </td>
                          </tr>
                          <tr className="border-t">
                            <td className="px-3 py-2">Contact submissions</td>
                            <td className="px-3 py-2">
                              {formatInteger(
                                analyticsSummary.comparison.totals.submissions.current,
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {formatInteger(
                                analyticsSummary.comparison.totals.submissions.previous,
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {formatDeltaSummary(
                                analyticsSummary.comparison.totals.submissions,
                              )}
                            </td>
                          </tr>
                          <tr className="border-t">
                            <td className="px-3 py-2">Submit rate</td>
                            <td className="px-3 py-2">
                              {formatPercent(
                                analyticsSummary.comparison.totals.conversionRatePct.current,
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {formatPercent(
                                analyticsSummary.comparison.totals.conversionRatePct.previous,
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {formatDeltaSummary(
                                analyticsSummary.comparison.totals.conversionRatePct,
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="Conversion funnel"
                    description="Progression from pageview to contact submission."
                  >
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                          <tr className="text-left">
                            <th className="px-3 py-2 font-medium">Step</th>
                            <th className="px-3 py-2 font-medium">Count</th>
                            <th className="px-3 py-2 font-medium">From previous</th>
                            <th className="px-3 py-2 font-medium">From pageviews</th>
                            <th className="px-3 py-2 font-medium">Progress</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analyticsSummary.funnel.steps.map((step) => (
                            <tr key={step.key} className="border-t">
                              <td className="px-3 py-2">{step.label}</td>
                              <td className="px-3 py-2">
                                {formatInteger(step.count)}
                              </td>
                              <td className="px-3 py-2">
                                {formatPercent(step.conversionFromPreviousPct)}
                              </td>
                              <td className="px-3 py-2">
                                {formatPercent(step.conversionFromFirstPct)}
                              </td>
                              <td className="px-3 py-2">
                                <div className="min-w-[140px]">
                                  <Progress
                                    value={Math.min(
                                      100,
                                      Math.max(0, step.conversionFromFirstPct),
                                    )}
                                  />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Form views and starts come from custom analytics events
                      (`contact_form_view` and `contact_form_start`).
                    </p>
                  </SectionCard>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <SectionCard
                      title="UTM campaign attribution"
                      description="Traffic and submissions grouped by source/medium/campaign."
                    >
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="px-3 py-2 font-medium">Source</th>
                              <th className="px-3 py-2 font-medium">Medium</th>
                              <th className="px-3 py-2 font-medium">Campaign</th>
                              <th className="px-3 py-2 font-medium">Pageviews</th>
                              <th className="px-3 py-2 font-medium">Submissions</th>
                              <th className="px-3 py-2 font-medium">Submit rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.attribution.campaigns.length > 0 ? (
                              analyticsSummary.attribution.campaigns.map((row) => (
                                <tr
                                  key={`${row.utmSource}-${row.utmMedium}-${row.utmCampaign}`}
                                  className="border-t"
                                >
                                  <td className="px-3 py-2 text-xs">{row.utmSource}</td>
                                  <td className="px-3 py-2 text-xs">{row.utmMedium}</td>
                                  <td className="px-3 py-2 text-xs">{row.utmCampaign}</td>
                                  <td className="px-3 py-2">
                                    {formatInteger(row.pageviews)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatInteger(row.submissions)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatPercent(row.submissionRatePct)}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                                  No UTM campaign data in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Top UTM sources"
                      description="Performance rolled up at source level."
                    >
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="px-3 py-2 font-medium">Source</th>
                              <th className="px-3 py-2 font-medium">Pageviews</th>
                              <th className="px-3 py-2 font-medium">Submissions</th>
                              <th className="px-3 py-2 font-medium">Submit rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.attribution.sources.length > 0 ? (
                              analyticsSummary.attribution.sources.map((row) => (
                                <tr key={row.utmSource} className="border-t">
                                  <td className="px-3 py-2 text-xs">{row.utmSource}</td>
                                  <td className="px-3 py-2">
                                    {formatInteger(row.pageviews)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatInteger(row.submissions)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatPercent(row.submissionRatePct)}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                                  No attributed source data in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>
                  </div>

                  <SectionCard
                    title="Daily performance"
                    description="Compact day-by-day view for traffic, visitors, sessions, and lead conversion."
                  >
                    <div className="overflow-x-auto rounded-md border">
                      <div className="max-h-[420px] min-w-[860px] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-muted/40">
                            <tr className="text-left">
                              <th className="px-3 py-2 font-medium">Date</th>
                              <th className="px-3 py-2 font-medium">Pageviews</th>
                              <th className="px-3 py-2 font-medium">Visitors</th>
                              <th className="px-3 py-2 font-medium">Sessions</th>
                              <th className="px-3 py-2 font-medium">Submissions</th>
                              <th className="px-3 py-2 font-medium">Submit rate</th>
                              <th className="px-3 py-2 font-medium">Traffic vs peak</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dailyRows.length > 0 ? (
                              dailyRows.map((row) => {
                                const peakTrafficShare = Math.round(
                                  (row.pageviews / peakPageviews) * 100,
                                );

                                return (
                                  <tr key={row.date} className="border-t align-top">
                                    <td className="px-3 py-2 text-xs text-muted-foreground">
                                      {formatDateLabel(row.date)}
                                    </td>
                                    <td className="px-3 py-2">
                                      {formatInteger(row.pageviews)}
                                    </td>
                                    <td className="px-3 py-2">{formatInteger(row.visitors)}</td>
                                    <td className="px-3 py-2">{formatInteger(row.sessions)}</td>
                                    <td className="px-3 py-2">
                                      {formatInteger(row.submissions)}
                                    </td>
                                    <td className="px-3 py-2">
                                      {formatPercent(row.submitRatePct)}
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="min-w-[140px] space-y-1">
                                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                          <span>vs peak</span>
                                          <span>{formatInteger(peakTrafficShare)}%</span>
                                        </div>
                                        <Progress value={peakTrafficShare} />
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={7}>
                                  No daily traffic data in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </SectionCard>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <SectionCard
                      title="Top pages"
                      description="Most visited paths in the selected range."
                    >
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="w-12 px-3 py-2 font-medium">#</th>
                              <th className="px-3 py-2 font-medium">Path</th>
                              <th className="px-3 py-2 font-medium">Pageviews</th>
                              <th className="px-3 py-2 font-medium">Visitors</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.topPages.length > 0 ? (
                              analyticsSummary.topPages.map((row, index) => (
                                <tr key={row.path} className="border-t">
                                  <td className="px-3 py-2 text-muted-foreground">
                                    {index + 1}
                                  </td>
                                  <td className="px-3 py-2 text-xs break-all">{row.path}</td>
                                  <td className="px-3 py-2">{formatInteger(row.pageviews)}</td>
                                  <td className="px-3 py-2">
                                    {formatInteger(row.uniqueVisitors)}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                                  No pageview data in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Top referrers"
                      description="External hosts sending visitors to your website."
                    >
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="w-12 px-3 py-2 font-medium">#</th>
                              <th className="px-3 py-2 font-medium">Referrer host</th>
                              <th className="px-3 py-2 font-medium">Events</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.topReferrers.length > 0 ? (
                              analyticsSummary.topReferrers.map((row, index) => (
                                <tr key={row.referrerHost} className="border-t">
                                  <td className="px-3 py-2 text-muted-foreground">
                                    {index + 1}
                                  </td>
                                  <td className="px-3 py-2 text-xs break-all">
                                    {row.referrerHost}
                                  </td>
                                  <td className="px-3 py-2">{formatInteger(row.events)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                                  No referrer data in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <SectionCard
                      title="Device mix"
                      description="Share of tracked events by device type."
                    >
                      {analyticsSummary.devices.length > 0 ? (
                        <div className="space-y-3">
                          {analyticsSummary.devices.map((row) => (
                            <div key={row.deviceType} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">
                                  {formatDeviceLabel(row.deviceType)}
                                </span>
                                <span>
                                  {formatInteger(row.events)} events (
                                  {formatPercent(row.share)})
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
                    </SectionCard>

                    <SectionCard
                      title="Lead sources"
                      description={`Unique source hosts: ${formatInteger(analyticsSummary.contactForm.uniqueSourceHosts)}`}
                    >
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="rounded-md border bg-muted/20 p-3">
                          <p className="text-xs text-muted-foreground">Total submissions</p>
                          <p className="mt-1 text-lg font-semibold">
                            {formatInteger(analyticsSummary.contactForm.submissions)}
                          </p>
                        </div>
                        <div className="rounded-md border bg-muted/20 p-3">
                          <p className="text-xs text-muted-foreground">Avg submissions / day</p>
                          <p className="mt-1 text-lg font-semibold">
                            {formatRatio(summaryInsights.avgDailySubmissions)}
                          </p>
                        </div>
                      </div>
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="w-12 px-3 py-2 font-medium">#</th>
                              <th className="px-3 py-2 font-medium">Source host</th>
                              <th className="px-3 py-2 font-medium">Submissions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.contactForm.topSourceHosts.length > 0 ? (
                              analyticsSummary.contactForm.topSourceHosts.map(
                                (row, index) => (
                                  <tr key={row.sourceHost} className="border-t">
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {index + 1}
                                    </td>
                                    <td className="px-3 py-2 text-xs break-all">
                                      {row.sourceHost}
                                    </td>
                                    <td className="px-3 py-2">
                                      {formatInteger(row.submissions)}
                                    </td>
                                  </tr>
                                ),
                              )
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                                  No contact submissions in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>
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
