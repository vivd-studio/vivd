import { z } from "zod";

export const analyticsSummaryRangeSchema = z.union([
  z.literal(7),
  z.literal(30),
]);

export const analyticsSummaryReadInputSchema = z.object({
  rangeDays: analyticsSummaryRangeSchema.default(30),
});

export type AnalyticsSummaryRange = z.infer<typeof analyticsSummaryRangeSchema>;
export type AnalyticsSummaryReadInput = z.infer<
  typeof analyticsSummaryReadInputSchema
>;

export interface AnalyticsComparisonMetric {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
}

export interface AnalyticsSummaryPayload {
  pluginId: "analytics";
  enabled: boolean;
  rangeDays: AnalyticsSummaryRange;
  rangeStart: string;
  rangeEnd: string;
  totals: {
    events: number;
    pageviews: number;
    uniqueVisitors: number;
    uniqueSessions: number;
    avgPagesPerSession: number;
  };
  daily: Array<{
    date: string;
    events: number;
    pageviews: number;
    uniqueVisitors: number;
    uniqueSessions: number;
  }>;
  topPages: Array<{
    path: string;
    pageviews: number;
    uniqueVisitors: number;
  }>;
  topReferrers: Array<{
    referrerHost: string;
    events: number;
  }>;
  devices: Array<{
    deviceType: string;
    events: number;
    share: number;
  }>;
  countries: Array<{
    countryCode: string;
    pageviews: number;
    uniqueVisitors: number;
    uniqueSessions: number;
    share: number;
  }>;
  contactForm: {
    enabled: boolean;
    submissions: number;
    uniqueSourceHosts: number;
    conversionRatePct: number;
    daily: Array<{
      date: string;
      submissions: number;
    }>;
    topSourceHosts: Array<{
      sourceHost: string;
      submissions: number;
    }>;
  };
  comparison: {
    previousRangeStart: string;
    previousRangeEnd: string;
    totals: {
      pageviews: AnalyticsComparisonMetric;
      uniqueVisitors: AnalyticsComparisonMetric;
      uniqueSessions: AnalyticsComparisonMetric;
      submissions: AnalyticsComparisonMetric;
      conversionRatePct: AnalyticsComparisonMetric;
    };
  };
  funnel: {
    pageviews: number;
    formViews: number;
    formStarts: number;
    submissions: number;
    steps: Array<{
      key: "pageviews" | "formViews" | "formStarts" | "submissions";
      label: string;
      count: number;
      conversionFromPreviousPct: number;
      conversionFromFirstPct: number;
    }>;
  };
  attribution: {
    campaigns: Array<{
      utmSource: string;
      utmMedium: string;
      utmCampaign: string;
      pageviews: number;
      submissions: number;
      submissionRatePct: number;
    }>;
    sources: Array<{
      utmSource: string;
      pageviews: number;
      submissions: number;
      submissionRatePct: number;
    }>;
  };
  pathAnalysis: {
    sessionsWithPageviews: number;
    totalTransitions: number;
    topEntryPages: Array<{
      path: string;
      sessions: number;
      share: number;
    }>;
    topExitPages: Array<{
      path: string;
      sessions: number;
      share: number;
    }>;
    topTransitions: Array<{
      fromPath: string;
      toPath: string;
      transitions: number;
      uniqueSessions: number;
      share: number;
    }>;
  };
}
