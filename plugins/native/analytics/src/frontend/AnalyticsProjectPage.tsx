import { type ReactNode, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { trpc } from "@/plugins/host";
import { LoadingSpinner } from "@/plugins/host";
import {
  Button,
  Callout,
  CalloutDescription,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
  Progress,
  StatTile,
  StatTileHelper,
  StatTileLabel,
  StatTileValue,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vivd/ui";
import { SettingsPageShell } from "@/plugins/host";
import {
  ProjectPluginAccessActions,
  ProjectPluginPageActions,
  useProjectPluginPageModel,
} from "@/plugins/host";
import {
  ANALYTICS_SUMMARY_READ_ID,
  type AnalyticsSummaryPayload,
} from "../shared/summary";

type AnalyticsRange = 7 | 30;
type ComparisonMetric =
  AnalyticsSummaryPayload["comparison"]["totals"]["pageviews"];
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
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "Unknown";
  return getCountryDisplayNames()?.of(normalized) || normalized;
}

function formatCountryFlag(value: string): string {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
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
    <StatTile>
      <StatTileLabel>{label}</StatTileLabel>
      <StatTileValue>{value}</StatTileValue>
      {caption ? <StatTileHelper>{caption}</StatTileHelper> : null}
    </StatTile>
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
    <Panel className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </Panel>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <StatTile>
      <StatTileLabel>{label}</StatTileLabel>
      <StatTileValue className="text-lg">{value}</StatTileValue>
    </StatTile>
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
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const slug = projectSlug || "";
  const [rangeDays, setRangeDays] = useState<AnalyticsRange>(30);
  const isEmbedded = useMemo(
    () => new URLSearchParams(location.search).get("embedded") === "1",
    [location.search],
  );

  const {
    typedPluginId,
    pluginInfoQuery: analyticsInfoQuery,
    canEnablePlugin: canEnableProjectAnalytics,
    canRequestPluginAccess: canRequestAnalyticsAccess,
    pluginEnabled: analyticsEnabled,
    needsEnable: analyticsNeedsProjectEnable,
    isRequestPending,
    requestAccessLabel,
    disabledCopy,
    ensureMutation: analyticsEnsureMutation,
    requestAccessMutation,
    refreshPluginPage,
  } = useProjectPluginPageModel({
    projectSlug: slug,
    pluginId: "analytics",
    isEmbedded,
    documentTitle: ({ projectTitle }) => `${projectTitle} Analytics`,
    enableToast: {
      success: "Analytics enabled for this project",
      error: "Failed to enable Analytics",
    },
    requestAccessToast: {
      success: "Access request sent",
      error: "Failed to send access request",
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
      analyticsSummary.contactForm.daily.map((row) => [
        row.date,
        row.submissions,
      ]),
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
          submitRatePct:
            row.pageviews > 0 ? (submissions / row.pageviews) * 100 : 0,
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
      avgDailySubmissions:
        analyticsSummary.contactForm.submissions / dailyRows.length,
      topTrafficDay,
      topLeadDay,
    };
  }, [analyticsSummary, dailyRows]);

  const handleRefresh = () => {
    void refreshPluginPage(
      analyticsEnabled ? [() => analyticsSummaryQuery.refetch()] : [],
    );
  };

  if (!projectSlug) {
    return (
      <div className="text-sm text-muted-foreground">Missing project slug.</div>
    );
  }

  return (
    <SettingsPageShell
      title="Analytics"
      description={`Business analytics dashboard for ${projectSlug}.`}
      className={
        isEmbedded ? "mx-auto w-full max-w-6xl px-4 py-4 sm:px-6" : undefined
      }
      actions={
        <ProjectPluginPageActions
          projectSlug={projectSlug}
          isEmbedded={isEmbedded}
          backTarget="project"
          onRefresh={handleRefresh}
          isRefreshing={
            analyticsInfoQuery.isFetching || analyticsSummaryQuery.isFetching
          }
        />
      }
    >
      <Panel>
        <PanelHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <PanelTitle>Website + Lead Analytics</PanelTitle>
            </div>
            <StatusPill tone={analyticsEnabled ? "success" : "neutral"}>
              {analyticsEnabled
                ? "Enabled"
                : analyticsNeedsProjectEnable
                  ? "Available"
                  : "Disabled"}
            </StatusPill>
          </div>
          {analyticsEnabled ? (
            <Panel
              tone="sunken"
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div>
                <p className="text-xs text-muted-foreground">
                  {analyticsRangeLabel}
                </p>
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
            </Panel>
          ) : null}
        </PanelHeader>
        <PanelContent className="space-y-5">
          {analyticsInfoQuery.error ? (
            <Callout tone="danger">
              <CalloutDescription>
                Failed to load analytics settings:{" "}
                {analyticsInfoQuery.error.message}
              </CalloutDescription>
            </Callout>
          ) : null}

          {!analyticsEnabled ? (
            <Callout tone="warn">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{disabledCopy}</span>
                {analyticsNeedsProjectEnable || canRequestAnalyticsAccess ? (
                  <ProjectPluginAccessActions
                    canEnablePlugin={
                      analyticsNeedsProjectEnable && canEnableProjectAnalytics
                    }
                    canRequestPluginAccess={
                      !(
                        analyticsNeedsProjectEnable && canEnableProjectAnalytics
                      ) && canRequestAnalyticsAccess
                    }
                    isEnablePending={analyticsEnsureMutation.isPending}
                    isRequestPending={isRequestPending}
                    isRequestSubmitting={requestAccessMutation.isPending}
                    requestAccessLabel={requestAccessLabel}
                    onEnable={() =>
                      analyticsEnsureMutation.mutate({
                        slug,
                        pluginId: typedPluginId,
                      })
                    }
                    onRequestAccess={() =>
                      requestAccessMutation.mutate({
                        slug,
                        pluginId: typedPluginId,
                      })
                    }
                  />
                ) : null}
              </div>
            </Callout>
          ) : null}

          {analyticsEnabled ? (
            <>
              {analyticsSummaryQuery.error ? (
                <Callout tone="danger">
                  <CalloutDescription>
                    Failed to load analytics data:{" "}
                    {analyticsSummaryQuery.error.message}
                  </CalloutDescription>
                </Callout>
              ) : null}

              {analyticsSummaryQuery.isLoading ? (
                <Panel tone="sunken" className="px-3 py-8">
                  <LoadingSpinner message="Loading dashboard..." />
                </Panel>
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
                            value={formatInteger(
                              analyticsSummary.totals.pageviews,
                            )}
                          />
                          <MetricCard
                            label="Unique visitors"
                            value={formatInteger(
                              analyticsSummary.totals.uniqueVisitors,
                            )}
                          />
                          <MetricCard
                            label="Sessions"
                            value={formatInteger(
                              analyticsSummary.totals.uniqueSessions,
                            )}
                          />
                          <MetricCard
                            label="Pages / session"
                            value={formatRatio(
                              analyticsSummary.totals.avgPagesPerSession,
                            )}
                            caption="Higher values often indicate deeper engagement."
                          />
                          <MetricCard
                            label="Contact submissions"
                            value={formatInteger(
                              analyticsSummary.contactForm.submissions,
                            )}
                            caption={
                              analyticsSummary.contactForm.enabled
                                ? "Contact Form plugin active."
                                : "Contact Form plugin currently disabled."
                            }
                          />
                          <MetricCard
                            label="Submit rate"
                            value={formatPercent(
                              analyticsSummary.contactForm.conversionRatePct,
                            )}
                            caption="Submissions divided by pageviews."
                          />
                        </div>

                        <Panel tone="sunken" className="p-4">
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
                              value={formatRatio(
                                summaryInsights.avgDailyPageviews,
                              )}
                            />
                            <InsightRow
                              label="Avg submissions / day"
                              value={formatRatio(
                                summaryInsights.avgDailySubmissions,
                              )}
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
                        </Panel>
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Period comparison"
                      description={`Compared with the previous ${analyticsSummary.rangeDays}-day window (${analyticsSummary.comparison.previousRangeStart} to ${analyticsSummary.comparison.previousRangeEnd}).`}
                    >
                      <div className="overflow-x-auto rounded-md border">
                        <Table className="w-full text-sm">
                          <TableHeader>
                            <TableRow className="text-left">
                              <TableHead className="px-3 py-2 font-medium">
                                Metric
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Current
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Previous
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Change
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow className="border-t">
                              <TableCell className="px-3 py-2">
                                Pageviews
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatInteger(
                                  analyticsSummary.comparison.totals.pageviews
                                    .current,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatInteger(
                                  analyticsSummary.comparison.totals.pageviews
                                    .previous,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatDeltaSummary(
                                  analyticsSummary.comparison.totals.pageviews,
                                )}
                              </TableCell>
                            </TableRow>
                            <TableRow className="border-t">
                              <TableCell className="px-3 py-2">
                                Unique visitors
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatInteger(
                                  analyticsSummary.comparison.totals
                                    .uniqueVisitors.current,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatInteger(
                                  analyticsSummary.comparison.totals
                                    .uniqueVisitors.previous,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatDeltaSummary(
                                  analyticsSummary.comparison.totals
                                    .uniqueVisitors,
                                )}
                              </TableCell>
                            </TableRow>
                            <TableRow className="border-t">
                              <TableCell className="px-3 py-2">
                                Sessions
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatInteger(
                                  analyticsSummary.comparison.totals
                                    .uniqueSessions.current,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatInteger(
                                  analyticsSummary.comparison.totals
                                    .uniqueSessions.previous,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatDeltaSummary(
                                  analyticsSummary.comparison.totals
                                    .uniqueSessions,
                                )}
                              </TableCell>
                            </TableRow>
                            <TableRow className="border-t">
                              <TableCell className="px-3 py-2">
                                Contact submissions
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatInteger(
                                  analyticsSummary.comparison.totals.submissions
                                    .current,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatInteger(
                                  analyticsSummary.comparison.totals.submissions
                                    .previous,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatDeltaSummary(
                                  analyticsSummary.comparison.totals
                                    .submissions,
                                )}
                              </TableCell>
                            </TableRow>
                            <TableRow className="border-t">
                              <TableCell className="px-3 py-2">
                                Submit rate
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatPercent(
                                  analyticsSummary.comparison.totals
                                    .conversionRatePct.current,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatPercent(
                                  analyticsSummary.comparison.totals
                                    .conversionRatePct.previous,
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-2">
                                {formatDeltaSummary(
                                  analyticsSummary.comparison.totals
                                    .conversionRatePct,
                                )}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Conversion funnel"
                      description="Progression from pageview to contact submission."
                    >
                      <div className="overflow-x-auto rounded-md border">
                        <Table className="w-full text-sm">
                          <TableHeader>
                            <TableRow className="text-left">
                              <TableHead className="px-3 py-2 font-medium">
                                Step
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Count
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                From previous
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                From pageviews
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Progress
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {analyticsSummary.funnel.steps.map((step) => (
                              <TableRow key={step.key} className="border-t">
                                <TableCell className="px-3 py-2">
                                  {step.label}
                                </TableCell>
                                <TableCell className="px-3 py-2">
                                  {formatInteger(step.count)}
                                </TableCell>
                                <TableCell className="px-3 py-2">
                                  {formatPercent(
                                    step.conversionFromPreviousPct,
                                  )}
                                </TableCell>
                                <TableCell className="px-3 py-2">
                                  {formatPercent(step.conversionFromFirstPct)}
                                </TableCell>
                                <TableCell className="px-3 py-2">
                                  <div className="min-w-[140px]">
                                    <Progress
                                      value={Math.min(
                                        100,
                                        Math.max(
                                          0,
                                          step.conversionFromFirstPct,
                                        ),
                                      )}
                                    />
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
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
                          <Table className="w-full text-sm">
                            <TableHeader className="sticky top-0">
                              <TableRow className="text-left">
                                <TableHead className="px-3 py-2 font-medium">
                                  Date
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Pageviews
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Visitors
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Sessions
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Submissions
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Submit rate
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Traffic vs peak
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {dailyRows.length > 0 ? (
                                dailyRows.map((row) => {
                                  const peakTrafficShare = Math.round(
                                    (row.pageviews / peakPageviews) * 100,
                                  );

                                  return (
                                    <TableRow
                                      key={row.date}
                                      className="border-t align-top"
                                    >
                                      <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                                        {formatDateLabel(row.date)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.pageviews)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.visitors)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.sessions)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.submissions)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatPercent(row.submitRatePct)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        <div className="min-w-[140px] space-y-1">
                                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                            <span>vs peak</span>
                                            <span>
                                              {formatInteger(peakTrafficShare)}%
                                            </span>
                                          </div>
                                          <Progress value={peakTrafficShare} />
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })
                              ) : (
                                <TableRow className="border-t">
                                  <TableCell
                                    className="px-3 py-3 text-muted-foreground"
                                    colSpan={7}
                                  >
                                    No daily traffic data in this range.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </SectionCard>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <SectionCard
                        title="Top pages"
                        description="Most visited paths in the selected range."
                      >
                        <div className="overflow-x-auto rounded-md border">
                          <Table className="w-full text-sm">
                            <TableHeader>
                              <TableRow className="text-left">
                                <TableHead className="w-12 px-3 py-2 font-medium">
                                  #
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Path
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Pageviews
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Visitors
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {analyticsSummary.topPages.length > 0 ? (
                                analyticsSummary.topPages.map((row, index) => (
                                  <TableRow key={row.path} className="border-t">
                                    <TableCell className="px-3 py-2 text-muted-foreground">
                                      {index + 1}
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-xs break-all">
                                      {row.path}
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      {formatInteger(row.pageviews)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      {formatInteger(row.uniqueVisitors)}
                                    </TableCell>
                                  </TableRow>
                                ))
                              ) : (
                                <TableRow className="border-t">
                                  <TableCell
                                    className="px-3 py-3 text-muted-foreground"
                                    colSpan={4}
                                  >
                                    No pageview data in this range.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </SectionCard>

                      <SectionCard
                        title="Top referrers"
                        description="External hosts sending visitors to your website."
                      >
                        <div className="overflow-x-auto rounded-md border">
                          <Table className="w-full text-sm">
                            <TableHeader>
                              <TableRow className="text-left">
                                <TableHead className="w-12 px-3 py-2 font-medium">
                                  #
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Referrer host
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Events
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {analyticsSummary.topReferrers.length > 0 ? (
                                analyticsSummary.topReferrers.map(
                                  (row, index) => (
                                    <TableRow
                                      key={row.referrerHost}
                                      className="border-t"
                                    >
                                      <TableCell className="px-3 py-2 text-muted-foreground">
                                        {index + 1}
                                      </TableCell>
                                      <TableCell className="px-3 py-2 text-xs break-all">
                                        {row.referrerHost}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.events)}
                                      </TableCell>
                                    </TableRow>
                                  ),
                                )
                              ) : (
                                <TableRow className="border-t">
                                  <TableCell
                                    className="px-3 py-3 text-muted-foreground"
                                    colSpan={3}
                                  >
                                    No referrer data in this range.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
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
                            <Table className="w-full text-sm">
                              <TableHeader>
                                <TableRow className="text-left">
                                  <TableHead className="w-12 px-3 py-2 font-medium">
                                    #
                                  </TableHead>
                                  <TableHead className="px-3 py-2 font-medium">
                                    Country
                                  </TableHead>
                                  <TableHead className="px-3 py-2 font-medium">
                                    Pageviews
                                  </TableHead>
                                  <TableHead className="px-3 py-2 font-medium">
                                    Visitors
                                  </TableHead>
                                  <TableHead className="px-3 py-2 font-medium">
                                    Sessions
                                  </TableHead>
                                  <TableHead className="px-3 py-2 font-medium">
                                    Share
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {analyticsSummary.countries.length > 0 ? (
                                  analyticsSummary.countries.map(
                                    (row, index) => (
                                      <TableRow
                                        key={row.countryCode}
                                        className="border-t"
                                      >
                                        <TableCell className="px-3 py-2 text-muted-foreground">
                                          {index + 1}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                          <div className="flex items-center gap-2">
                                            <span
                                              aria-hidden="true"
                                              className="text-base"
                                            >
                                              {formatCountryFlag(
                                                row.countryCode,
                                              )}
                                            </span>
                                            <div className="min-w-0">
                                              <div>
                                                {formatCountryName(
                                                  row.countryCode,
                                                )}
                                              </div>
                                              <div className="text-xs text-muted-foreground">
                                                {row.countryCode === "unknown"
                                                  ? "Unknown source"
                                                  : row.countryCode}
                                              </div>
                                            </div>
                                          </div>
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                          {formatInteger(row.pageviews)}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                          {formatInteger(row.uniqueVisitors)}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                          {formatInteger(row.uniqueSessions)}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                          {formatPercent(row.share)}
                                        </TableCell>
                                      </TableRow>
                                    ),
                                  )
                                ) : (
                                  <TableRow className="border-t">
                                    <TableCell
                                      className="px-3 py-3 text-muted-foreground"
                                      colSpan={6}
                                    >
                                      No country data in this range.
                                    </TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Free DB-IP Lite self-host installs require
                            attribution:{" "}
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
                                <Progress
                                  value={Math.min(100, Math.max(0, row.share))}
                                />
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
                        <MiniMetric
                          label="Sessions with pageviews"
                          value={formatInteger(
                            analyticsSummary.pathAnalysis.sessionsWithPageviews,
                          )}
                        />
                        <MiniMetric
                          label="Tracked transitions"
                          value={formatInteger(
                            analyticsSummary.pathAnalysis.totalTransitions,
                          )}
                        />
                        <MiniMetric
                          label="Avg transitions / session"
                          value={formatRatio(
                            analyticsSummary.pathAnalysis
                              .sessionsWithPageviews > 0
                              ? analyticsSummary.pathAnalysis.totalTransitions /
                                  analyticsSummary.pathAnalysis
                                    .sessionsWithPageviews
                              : 0,
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <div className="overflow-x-auto rounded-md border">
                          <Table className="w-full text-sm">
                            <TableHeader>
                              <TableRow className="text-left">
                                <TableHead className="w-12 px-3 py-2 font-medium">
                                  #
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Top entry pages
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Sessions
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Share
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {analyticsSummary.pathAnalysis.topEntryPages
                                .length > 0 ? (
                                analyticsSummary.pathAnalysis.topEntryPages.map(
                                  (row, index) => (
                                    <TableRow
                                      key={row.path}
                                      className="border-t"
                                    >
                                      <TableCell className="px-3 py-2 text-muted-foreground">
                                        {index + 1}
                                      </TableCell>
                                      <TableCell className="px-3 py-2 text-xs break-all">
                                        {row.path}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.sessions)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatPercent(row.share)}
                                      </TableCell>
                                    </TableRow>
                                  ),
                                )
                              ) : (
                                <TableRow className="border-t">
                                  <TableCell
                                    className="px-3 py-3 text-muted-foreground"
                                    colSpan={4}
                                  >
                                    No entry-page data in this range.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="overflow-x-auto rounded-md border">
                          <Table className="w-full text-sm">
                            <TableHeader>
                              <TableRow className="text-left">
                                <TableHead className="w-12 px-3 py-2 font-medium">
                                  #
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Top exit pages
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Sessions
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Share
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {analyticsSummary.pathAnalysis.topExitPages
                                .length > 0 ? (
                                analyticsSummary.pathAnalysis.topExitPages.map(
                                  (row, index) => (
                                    <TableRow
                                      key={row.path}
                                      className="border-t"
                                    >
                                      <TableCell className="px-3 py-2 text-muted-foreground">
                                        {index + 1}
                                      </TableCell>
                                      <TableCell className="px-3 py-2 text-xs break-all">
                                        {row.path}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.sessions)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatPercent(row.share)}
                                      </TableCell>
                                    </TableRow>
                                  ),
                                )
                              ) : (
                                <TableRow className="border-t">
                                  <TableCell
                                    className="px-3 py-3 text-muted-foreground"
                                    colSpan={4}
                                  >
                                    No exit-page data in this range.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-md border">
                        <Table className="w-full text-sm">
                          <TableHeader>
                            <TableRow className="text-left">
                              <TableHead className="w-12 px-3 py-2 font-medium">
                                #
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                From
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                To
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Transitions
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Sessions
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Share
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {analyticsSummary.pathAnalysis.topTransitions
                              .length > 0 ? (
                              analyticsSummary.pathAnalysis.topTransitions.map(
                                (row, index) => (
                                  <TableRow
                                    key={`${row.fromPath}-${row.toPath}`}
                                    className="border-t"
                                  >
                                    <TableCell className="px-3 py-2 text-muted-foreground">
                                      {index + 1}
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-xs break-all">
                                      {row.fromPath}
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-xs break-all">
                                      {row.toPath}
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      {formatInteger(row.transitions)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      {formatInteger(row.uniqueSessions)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      {formatPercent(row.share)}
                                    </TableCell>
                                  </TableRow>
                                ),
                              )
                            ) : (
                              <TableRow className="border-t">
                                <TableCell
                                  className="px-3 py-3 text-muted-foreground"
                                  colSpan={6}
                                >
                                  No path-transition data in this range.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
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
                          <Table className="w-full text-sm">
                            <TableHeader>
                              <TableRow className="text-left">
                                <TableHead className="px-3 py-2 font-medium">
                                  Source
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Medium
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Campaign
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Pageviews
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Submissions
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Submit rate
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {analyticsSummary.attribution.campaigns.length >
                              0 ? (
                                analyticsSummary.attribution.campaigns.map(
                                  (row) => (
                                    <TableRow
                                      key={`${row.utmSource}-${row.utmMedium}-${row.utmCampaign}`}
                                      className="border-t"
                                    >
                                      <TableCell className="px-3 py-2 text-xs">
                                        {row.utmSource}
                                      </TableCell>
                                      <TableCell className="px-3 py-2 text-xs">
                                        {row.utmMedium}
                                      </TableCell>
                                      <TableCell className="px-3 py-2 text-xs">
                                        {row.utmCampaign}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.pageviews)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.submissions)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatPercent(row.submissionRatePct)}
                                      </TableCell>
                                    </TableRow>
                                  ),
                                )
                              ) : (
                                <TableRow className="border-t">
                                  <TableCell
                                    className="px-3 py-3 text-muted-foreground"
                                    colSpan={6}
                                  >
                                    No UTM campaign data in this range.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </SectionCard>

                      <SectionCard
                        title="Top UTM sources"
                        description="Performance rolled up at source level."
                      >
                        <div className="overflow-x-auto rounded-md border">
                          <Table className="w-full text-sm">
                            <TableHeader>
                              <TableRow className="text-left">
                                <TableHead className="px-3 py-2 font-medium">
                                  Source
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Pageviews
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Submissions
                                </TableHead>
                                <TableHead className="px-3 py-2 font-medium">
                                  Submit rate
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {analyticsSummary.attribution.sources.length >
                              0 ? (
                                analyticsSummary.attribution.sources.map(
                                  (row) => (
                                    <TableRow
                                      key={row.utmSource}
                                      className="border-t"
                                    >
                                      <TableCell className="px-3 py-2 text-xs">
                                        {row.utmSource}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.pageviews)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatInteger(row.submissions)}
                                      </TableCell>
                                      <TableCell className="px-3 py-2">
                                        {formatPercent(row.submissionRatePct)}
                                      </TableCell>
                                    </TableRow>
                                  ),
                                )
                              ) : (
                                <TableRow className="border-t">
                                  <TableCell
                                    className="px-3 py-3 text-muted-foreground"
                                    colSpan={4}
                                  >
                                    No attributed source data in this range.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
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
                        <MiniMetric
                          label="Total submissions"
                          value={formatInteger(
                            analyticsSummary.contactForm.submissions,
                          )}
                        />
                        <MiniMetric
                          label="Avg submissions / day"
                          value={formatRatio(
                            summaryInsights.avgDailySubmissions,
                          )}
                        />
                      </div>
                      <div className="overflow-x-auto rounded-md border">
                        <Table className="w-full text-sm">
                          <TableHeader>
                            <TableRow className="text-left">
                              <TableHead className="w-12 px-3 py-2 font-medium">
                                #
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Source host
                              </TableHead>
                              <TableHead className="px-3 py-2 font-medium">
                                Submissions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {analyticsSummary.contactForm.topSourceHosts
                              .length > 0 ? (
                              analyticsSummary.contactForm.topSourceHosts.map(
                                (row, index) => (
                                  <TableRow
                                    key={row.sourceHost}
                                    className="border-t"
                                  >
                                    <TableCell className="px-3 py-2 text-muted-foreground">
                                      {index + 1}
                                    </TableCell>
                                    <TableCell className="px-3 py-2 text-xs break-all">
                                      {row.sourceHost}
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                      {formatInteger(row.submissions)}
                                    </TableCell>
                                  </TableRow>
                                ),
                              )
                            ) : (
                              <TableRow className="border-t">
                                <TableCell
                                  className="px-3 py-3 text-muted-foreground"
                                  colSpan={3}
                                >
                                  No contact submissions in this range.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </SectionCard>
                  </TabsContent>
                </Tabs>
              ) : null}
            </>
          ) : null}
        </PanelContent>
      </Panel>
    </SettingsPageShell>
  );
}
