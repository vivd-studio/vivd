import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { ROUTES } from "@/app/router";
import { LoadingSpinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
import { formatDocumentTitle } from "@/lib/brand";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import {
  ANALYTICS_SUMMARY_READ_ID,
  type AnalyticsSummaryPayload,
} from "../shared/summary";

type AnalyticsRange = 7 | 30;
type ComparisonMetric = AnalyticsSummaryPayload["comparison"]["totals"]["pageviews"];
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

let countryDisplayNames: Intl.DisplayNames | null | undefined;

function getCountryDisplayNames(): Intl.DisplayNames | null {
  if (countryDisplayNames !== undefined) return countryDisplayNames;
  try {
    countryDisplayNames =
      typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(undefined, { type: "region" })
        : null;
  } catch {
    countryDisplayNames = null;
  }
  return countryDisplayNames;
}

function formatCountryName(value: string): string {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "Unknown";
  return getCountryDisplayNames()?.of(normalized) || normalized;
}

function formatCountryFlag(value: string): string {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "??";
  return String.fromCodePoint(
    ...normalized.split("").map((char) => 127397 + char.charCodeAt(0)),
  );
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

export default function AnalyticsProjectPage() {
  const { data: session } = authClient.useSession();
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const utils = trpc.useUtils();
  const slug = projectSlug || "";
  const typedPluginId = "analytics" as RouterOutputs["plugins"]["catalog"]["plugins"][number]["pluginId"];
  const [rangeDays, setRangeDays] = useState<AnalyticsRange>(30);
  const isEmbedded = useMemo(
    () => new URLSearchParams(location.search).get("embedded") === "1",
    [location.search],
  );

  const analyticsInfoQuery = trpc.plugins.info.useQuery(
    { slug, pluginId: typedPluginId },
    { enabled: !!projectSlug },
  );
  const projectListQuery = trpc.project.list.useQuery(undefined, {
    enabled: !!projectSlug,
  });
  const projectTitle =
    projectListQuery.data?.projects?.find((project) => project.slug === slug)?.title ?? slug;
  const analyticsEnabled = !!analyticsInfoQuery.data?.enabled;
  const analyticsEntitled = analyticsInfoQuery.data?.entitled ?? false;
  const analyticsNeedsProjectEnable =
    analyticsEntitled && !analyticsEnabled && !analyticsInfoQuery.data?.instanceId;
  const canEnableProjectAnalytics = session?.user?.role === "super_admin";
  const analyticsEnsureMutation = trpc.plugins.ensure.useMutation({
    onSuccess: async () => {
      toast.success("Analytics enabled for this project");
      await Promise.all([
        utils.plugins.catalog.invalidate({ slug }),
        utils.plugins.info.invalidate({ slug, pluginId: typedPluginId }),
      ]);
    },
    onError: (error) => {
      toast.error("Failed to enable Analytics", {
        description: error.message,
      });
    },
  });

  const analyticsSummaryQuery = trpc.plugins.read.useQuery(
    {
      slug,
      pluginId: typedPluginId,
      readId: ANALYTICS_SUMMARY_READ_ID,
      input: { rangeDays },
    },
    { enabled: !!projectSlug && analyticsEnabled },
  );
  const analyticsSummary = analyticsSummaryQuery.data?.result as
    | AnalyticsSummaryPayload
    | undefined;

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

  useEffect(() => {
    if (!projectSlug) return;
    document.title = formatDocumentTitle(`${projectTitle} Analytics`);
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [projectSlug, projectTitle]);

  if (!projectSlug) {
    return <div className="text-sm text-muted-foreground">Missing project slug.</div>;
  }

  return (
    <SettingsPageShell
      title="Analytics"
      description={`Business analytics dashboard for ${projectSlug}.`}
      className={isEmbedded ? "mx-auto w-full max-w-6xl px-4 py-4 sm:px-6" : undefined}
      actions={
        <div className="flex items-center gap-2">
          {!isEmbedded ? (
            <Button variant="outline" asChild>
              <Link to={ROUTES.PROJECT(projectSlug)}>Back to project</Link>
            </Button>
          ) : null}
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
              {analyticsEnabled
                ? "Enabled"
                : analyticsNeedsProjectEnable
                  ? "Available"
                  : "Disabled"}
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {analyticsNeedsProjectEnable
                    ? canEnableProjectAnalytics
                      ? "Analytics is available for this instance but has not been enabled for this project yet."
                      : "Analytics is available for this instance, but a super-admin still needs to enable it for this project."
                    : "Analytics is not enabled for this project. Ask a super-admin to enable Analytics in the admin plugin settings."}
                </span>
                {analyticsNeedsProjectEnable && canEnableProjectAnalytics ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      analyticsEnsureMutation.mutate({
                        slug,
                        pluginId: typedPluginId,
                      })
                    }
                    disabled={analyticsEnsureMutation.isPending}
                  >
                    {analyticsEnsureMutation.isPending ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        Enabling...
                      </>
                    ) : (
                      "Enable for this project"
                    )}
                  </Button>
                ) : null}
              </div>
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
                <Tabs defaultValue="overview" className="w-full">
                  <div className="overflow-x-auto pb-1">
                    <TabsList className="w-max min-w-full justify-start">
                      <TabsTrigger value="overview">Overview</TabsTrigger>
                      <TabsTrigger value="traffic">Traffic</TabsTrigger>
                      <TabsTrigger value="behavior">Behavior</TabsTrigger>
                      <TabsTrigger value="attribution">Attribution</TabsTrigger>
                      <TabsTrigger value="leads">Leads</TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="overview" className="mt-6 space-y-6">
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
                                <td className="px-3 py-2">{formatInteger(step.count)}</td>
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
                  </TabsContent>

                  <TabsContent value="traffic" className="mt-6 space-y-6">
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
                        title="Country breakdown"
                        description="Where tracked pageviews and sessions originated."
                      >
                        <div className="space-y-3">
                          <div className="overflow-x-auto rounded-md border">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/30">
                                <tr className="text-left">
                                  <th className="w-12 px-3 py-2 font-medium">#</th>
                                  <th className="px-3 py-2 font-medium">Country</th>
                                  <th className="px-3 py-2 font-medium">Pageviews</th>
                                  <th className="px-3 py-2 font-medium">Visitors</th>
                                  <th className="px-3 py-2 font-medium">Sessions</th>
                                  <th className="px-3 py-2 font-medium">Share</th>
                                </tr>
                              </thead>
                              <tbody>
                                {analyticsSummary.countries.length > 0 ? (
                                  analyticsSummary.countries.map((row, index) => (
                                    <tr key={row.countryCode} className="border-t">
                                      <td className="px-3 py-2 text-muted-foreground">
                                        {index + 1}
                                      </td>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <span aria-hidden="true" className="text-base">
                                            {formatCountryFlag(row.countryCode)}
                                          </span>
                                          <div className="min-w-0">
                                            <div>{formatCountryName(row.countryCode)}</div>
                                            <div className="text-xs text-muted-foreground">
                                              {row.countryCode === "unknown"
                                                ? "Unknown source"
                                                : row.countryCode}
                                            </div>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2">
                                        {formatInteger(row.pageviews)}
                                      </td>
                                      <td className="px-3 py-2">
                                        {formatInteger(row.uniqueVisitors)}
                                      </td>
                                      <td className="px-3 py-2">
                                        {formatInteger(row.uniqueSessions)}
                                      </td>
                                      <td className="px-3 py-2">
                                        {formatPercent(row.share)}
                                      </td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr className="border-t">
                                    <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                                      No country data in this range.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Free DB-IP Lite self-host installs require attribution:{" "}
                            <a
                              href="https://db-ip.com"
                              target="_blank"
                              rel="noreferrer"
                              className="underline underline-offset-2"
                            >
                              IP Geolocation by DB-IP
                            </a>
                            .
                          </p>
                        </div>
                      </SectionCard>

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
                    </div>
                  </TabsContent>

                  <TabsContent value="behavior" className="mt-6 space-y-6">
                    <SectionCard
                      title="Visitor paths"
                      description="How tracked sessions enter, move through, and leave the site."
                    >
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="rounded-md border bg-muted/20 p-3">
                          <p className="text-xs text-muted-foreground">
                            Sessions with pageviews
                          </p>
                          <p className="mt-1 text-lg font-semibold">
                            {formatInteger(analyticsSummary.pathAnalysis.sessionsWithPageviews)}
                          </p>
                        </div>
                        <div className="rounded-md border bg-muted/20 p-3">
                          <p className="text-xs text-muted-foreground">Tracked transitions</p>
                          <p className="mt-1 text-lg font-semibold">
                            {formatInteger(analyticsSummary.pathAnalysis.totalTransitions)}
                          </p>
                        </div>
                        <div className="rounded-md border bg-muted/20 p-3">
                          <p className="text-xs text-muted-foreground">
                            Avg transitions / session
                          </p>
                          <p className="mt-1 text-lg font-semibold">
                            {formatRatio(
                              analyticsSummary.pathAnalysis.sessionsWithPageviews > 0
                                ? analyticsSummary.pathAnalysis.totalTransitions /
                                    analyticsSummary.pathAnalysis.sessionsWithPageviews
                                : 0,
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <div className="overflow-x-auto rounded-md border">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/30">
                              <tr className="text-left">
                                <th className="w-12 px-3 py-2 font-medium">#</th>
                                <th className="px-3 py-2 font-medium">Top entry pages</th>
                                <th className="px-3 py-2 font-medium">Sessions</th>
                                <th className="px-3 py-2 font-medium">Share</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analyticsSummary.pathAnalysis.topEntryPages.length > 0 ? (
                                analyticsSummary.pathAnalysis.topEntryPages.map((row, index) => (
                                  <tr key={row.path} className="border-t">
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {index + 1}
                                    </td>
                                    <td className="px-3 py-2 text-xs break-all">{row.path}</td>
                                    <td className="px-3 py-2">
                                      {formatInteger(row.sessions)}
                                    </td>
                                    <td className="px-3 py-2">{formatPercent(row.share)}</td>
                                  </tr>
                                ))
                              ) : (
                                <tr className="border-t">
                                  <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                                    No entry-page data in this range.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        <div className="overflow-x-auto rounded-md border">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/30">
                              <tr className="text-left">
                                <th className="w-12 px-3 py-2 font-medium">#</th>
                                <th className="px-3 py-2 font-medium">Top exit pages</th>
                                <th className="px-3 py-2 font-medium">Sessions</th>
                                <th className="px-3 py-2 font-medium">Share</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analyticsSummary.pathAnalysis.topExitPages.length > 0 ? (
                                analyticsSummary.pathAnalysis.topExitPages.map((row, index) => (
                                  <tr key={row.path} className="border-t">
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {index + 1}
                                    </td>
                                    <td className="px-3 py-2 text-xs break-all">{row.path}</td>
                                    <td className="px-3 py-2">
                                      {formatInteger(row.sessions)}
                                    </td>
                                    <td className="px-3 py-2">{formatPercent(row.share)}</td>
                                  </tr>
                                ))
                              ) : (
                                <tr className="border-t">
                                  <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                                    No exit-page data in this range.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="w-12 px-3 py-2 font-medium">#</th>
                              <th className="px-3 py-2 font-medium">From</th>
                              <th className="px-3 py-2 font-medium">To</th>
                              <th className="px-3 py-2 font-medium">Transitions</th>
                              <th className="px-3 py-2 font-medium">Sessions</th>
                              <th className="px-3 py-2 font-medium">Share</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.pathAnalysis.topTransitions.length > 0 ? (
                              analyticsSummary.pathAnalysis.topTransitions.map((row, index) => (
                                <tr
                                  key={`${row.fromPath}-${row.toPath}`}
                                  className="border-t"
                                >
                                  <td className="px-3 py-2 text-muted-foreground">
                                    {index + 1}
                                  </td>
                                  <td className="px-3 py-2 text-xs break-all">
                                    {row.fromPath}
                                  </td>
                                  <td className="px-3 py-2 text-xs break-all">
                                    {row.toPath}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatInteger(row.transitions)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {formatInteger(row.uniqueSessions)}
                                  </td>
                                  <td className="px-3 py-2">{formatPercent(row.share)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                                  No path-transition data in this range.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>
                  </TabsContent>

                  <TabsContent value="attribution" className="mt-6 space-y-6">
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
                  </TabsContent>

                  <TabsContent value="leads" className="mt-6 space-y-6">
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
                              analyticsSummary.contactForm.topSourceHosts.map((row, index) => (
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
                              ))
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
                  </TabsContent>
                </Tabs>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
}
