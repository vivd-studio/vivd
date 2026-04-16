import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import {
  analyticsPluginConfigSchema,
  type AnalyticsPluginConfig,
} from "./config";
import {
  getAnalyticsScriptEndpoint,
  getAnalyticsTrackEndpoint,
} from "./publicApi";
import { getAnalyticsSnippets } from "./snippets";
import type {
  AnalyticsComparisonMetric,
  AnalyticsSummaryPayload,
} from "../shared/summary";
import type {
  AnalyticsPluginInstanceRow,
  AnalyticsPluginServiceDeps,
} from "./ports";

export interface AnalyticsPluginPayload {
  pluginId: "analytics";
  instanceId: string;
  status: string;
  created: boolean;
  publicToken: string;
  config: AnalyticsPluginConfig;
  snippets: {
    html: string;
    astro: string;
  };
}

export interface AnalyticsPluginInfoPayload {
  pluginId: "analytics";
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: AnalyticsPluginConfig | null;
  snippets: {
    html: string;
    astro: string;
  } | null;
  usage: {
    scriptEndpoint: string;
    trackEndpoint: string;
    eventTypes: string[];
    respectDoNotTrack: boolean;
    captureQueryString: boolean;
    enableClientTracking: boolean;
  };
  instructions: string[];
}

function toCount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildRangeStart(rangeDays: number, now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (rangeDays - 1));
  return start;
}

function buildPreviousRangeStart(rangeStart: Date, rangeDays: number): Date {
  const previousStart = new Date(rangeStart);
  previousStart.setUTCDate(previousStart.getUTCDate() - rangeDays);
  return previousStart;
}

function buildPreviousRangeEnd(rangeStart: Date): Date {
  const previousEnd = new Date(rangeStart);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  return previousEnd;
}

function roundToTwoDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function buildComparisonMetric(
  current: number,
  previous: number,
): AnalyticsComparisonMetric {
  const delta = current - previous;
  const deltaPct =
    previous > 0 ? roundToTwoDecimals((delta / previous) * 100) : null;
  return {
    current,
    previous,
    delta,
    deltaPct,
  };
}

function normalizeAttributionLabel(value: string | null, fallback: string): string {
  const normalized = (value || "").trim();
  return normalized || fallback;
}

function normalizeCountryCode(value: string | null | undefined): string {
  const normalized = (value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "unknown";
}

function normalizeAnalyticsConfig(configJson: unknown): AnalyticsPluginConfig {
  const parsed = analyticsPluginConfigSchema.safeParse(configJson ?? {});
  if (parsed.success) return parsed.data;
  return analyticsPluginConfigSchema.parse({});
}

function buildUsage(input: {
  scriptEndpoint: string;
  trackEndpoint: string;
  config: AnalyticsPluginConfig | null;
}) {
  const config = input.config ?? analyticsPluginConfigSchema.parse({});
  return {
    scriptEndpoint: input.scriptEndpoint,
    trackEndpoint: input.trackEndpoint,
    eventTypes: ["pageview", "custom"],
    respectDoNotTrack: config.respectDoNotTrack,
    captureQueryString: config.captureQueryString,
    enableClientTracking: config.enableClientTracking,
  };
}

export class AnalyticsPluginNotEnabledError extends Error {
  constructor() {
    super(
      "Analytics plugin is not enabled for this project. Ask a super-admin to enable it first.",
    );
    this.name = "AnalyticsPluginNotEnabledError";
  }
}

export function createAnalyticsPluginService(
  deps: AnalyticsPluginServiceDeps,
) {
  const {
    db,
    tables,
    pluginEntitlementService,
    projectPluginInstanceService,
    getPublicPluginApiBaseUrl,
  } = deps;
  const { analyticsEvent, contactFormSubmission, projectPluginInstance } = tables;

  async function resolveAnalyticsPublicEndpoints() {
    const baseUrl = await getPublicPluginApiBaseUrl();
    return {
      scriptEndpoint: getAnalyticsScriptEndpoint(baseUrl),
      trackEndpoint: getAnalyticsTrackEndpoint(baseUrl),
    };
  }

  class AnalyticsPluginService {
  async ensureAnalyticsPlugin(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<AnalyticsPluginPayload> {
    const { row, created } = await projectPluginInstanceService.ensurePluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "analytics",
    });

    return await this.toPayload(row, created);
  }

  async getAnalyticsPlugin(options: {
    organizationId: string;
    projectSlug: string;
    ensure?: boolean;
  }): Promise<AnalyticsPluginPayload | null> {
    if (options.ensure) {
      return this.ensureAnalyticsPlugin(options);
    }

    const existing = await projectPluginInstanceService.getPluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "analytics",
    });
    if (!existing) return null;
    return await this.toPayload(existing, false);
  }

  async updateAnalyticsConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: AnalyticsPluginConfig;
  }): Promise<AnalyticsPluginPayload> {
    const [entitlement, existing] = await Promise.all([
      pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "analytics",
      }),
      projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "analytics",
      }),
    ]);

    if (entitlement.state !== "enabled" || !existing || existing.status !== "enabled") {
      throw new AnalyticsPluginNotEnabledError();
    }

    const parsedConfig = analyticsPluginConfigSchema.parse(options.config);
    const [updated] = await db
      .update(projectPluginInstance)
      .set({
        configJson: parsedConfig,
        updatedAt: new Date(),
      })
      .where(eq(projectPluginInstance.id, existing.id))
      .returning();

    if (updated) return await this.toPayload(updated, false);

    return await this.toPayload(
      {
        ...existing,
        configJson: parsedConfig,
      },
      false,
    );
  }

  async getAnalyticsSummary(options: {
    organizationId: string;
    projectSlug: string;
    rangeDays: 7 | 30;
  }): Promise<AnalyticsSummaryPayload> {
    const now = new Date();
    const rangeStartDate = buildRangeStart(options.rangeDays, now);
    const rangeStart = toIsoDay(rangeStartDate);
    const rangeEnd = toIsoDay(now);
    const previousRangeStartDate = buildPreviousRangeStart(
      rangeStartDate,
      options.rangeDays,
    );
    const previousRangeEndDate = buildPreviousRangeEnd(rangeStartDate);
    const previousRangeStart = toIsoDay(previousRangeStartDate);
    const previousRangeEnd = toIsoDay(previousRangeEndDate);

    const [entitlement, existing] = await Promise.all([
      pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "analytics",
      }),
      projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "analytics",
      }),
    ]);

    const contactPluginInstance = await projectPluginInstanceService.getPluginInstance({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: "contact_form",
    });
    const contactFormEnabled = contactPluginInstance?.status === "enabled";

    const enabled =
      entitlement.state === "enabled" && !!existing && existing.status === "enabled";

    const emptyDaily = Array.from({ length: options.rangeDays }, (_, index) => {
      const day = new Date(rangeStartDate);
      day.setUTCDate(day.getUTCDate() + index);
      return {
        date: toIsoDay(day),
        events: 0,
        pageviews: 0,
        uniqueVisitors: 0,
        uniqueSessions: 0,
      };
    });
    const emptyContactDaily = emptyDaily.map((row) => ({
      date: row.date,
      submissions: 0,
    }));
    const emptyComparison = {
      previousRangeStart,
      previousRangeEnd,
      totals: {
        pageviews: buildComparisonMetric(0, 0),
        uniqueVisitors: buildComparisonMetric(0, 0),
        uniqueSessions: buildComparisonMetric(0, 0),
        submissions: buildComparisonMetric(0, 0),
        conversionRatePct: buildComparisonMetric(0, 0),
      },
    };
    const emptyFunnel = {
      pageviews: 0,
      formViews: 0,
      formStarts: 0,
      submissions: 0,
      steps: [
        {
          key: "pageviews" as const,
          label: "Pageviews",
          count: 0,
          conversionFromPreviousPct: 0,
          conversionFromFirstPct: 0,
        },
        {
          key: "formViews" as const,
          label: "Form views",
          count: 0,
          conversionFromPreviousPct: 0,
          conversionFromFirstPct: 0,
        },
        {
          key: "formStarts" as const,
          label: "Form starts",
          count: 0,
          conversionFromPreviousPct: 0,
          conversionFromFirstPct: 0,
        },
        {
          key: "submissions" as const,
          label: "Submissions",
          count: 0,
          conversionFromPreviousPct: 0,
          conversionFromFirstPct: 0,
        },
      ],
    };
    const emptyPathAnalysis = {
      sessionsWithPageviews: 0,
      totalTransitions: 0,
      topEntryPages: [],
      topExitPages: [],
      topTransitions: [],
    };

    if (!enabled || !existing) {
      return {
        pluginId: "analytics",
        enabled,
        rangeDays: options.rangeDays,
        rangeStart,
        rangeEnd,
        totals: {
          events: 0,
          pageviews: 0,
          uniqueVisitors: 0,
          uniqueSessions: 0,
          avgPagesPerSession: 0,
        },
        daily: emptyDaily,
        topPages: [],
        topReferrers: [],
        devices: [],
        countries: [],
        contactForm: {
          enabled: contactFormEnabled,
          submissions: 0,
          uniqueSourceHosts: 0,
          conversionRatePct: 0,
          daily: emptyContactDaily,
          topSourceHosts: [],
        },
        comparison: emptyComparison,
        funnel: emptyFunnel,
        attribution: {
          campaigns: [],
          sources: [],
        },
        pathAnalysis: emptyPathAnalysis,
      };
    }

    const rangeWhere = and(
      eq(analyticsEvent.organizationId, options.organizationId),
      eq(analyticsEvent.projectSlug, options.projectSlug),
      eq(analyticsEvent.pluginInstanceId, existing.id),
      gte(analyticsEvent.createdAt, rangeStartDate),
    );
    const previousRangeWhere = and(
      eq(analyticsEvent.organizationId, options.organizationId),
      eq(analyticsEvent.projectSlug, options.projectSlug),
      eq(analyticsEvent.pluginInstanceId, existing.id),
      gte(analyticsEvent.createdAt, previousRangeStartDate),
      lt(analyticsEvent.createdAt, rangeStartDate),
    );

    const dayBucket = sql`date_trunc('day', ${analyticsEvent.createdAt} at time zone 'UTC')`;
    const dayLabel = sql<string>`to_char(${dayBucket}, 'YYYY-MM-DD')`;
    const contactDayBucket = sql`date_trunc('day', ${contactFormSubmission.createdAt} at time zone 'UTC')`;
    const contactDayLabel = sql<string>`to_char(${contactDayBucket}, 'YYYY-MM-DD')`;
    const contactRangeWhere = and(
      eq(contactFormSubmission.organizationId, options.organizationId),
      eq(contactFormSubmission.projectSlug, options.projectSlug),
      gte(contactFormSubmission.createdAt, rangeStartDate),
    );
    const previousContactRangeWhere = and(
      eq(contactFormSubmission.organizationId, options.organizationId),
      eq(contactFormSubmission.projectSlug, options.projectSlug),
      gte(contactFormSubmission.createdAt, previousRangeStartDate),
      lt(contactFormSubmission.createdAt, rangeStartDate),
    );
    const customEventNameExpr = sql<string | null>`nullif(lower(coalesce(${analyticsEvent.payload}->>'eventName', ${analyticsEvent.payload}->>'event', ${analyticsEvent.payload}->>'name', '')), '')`;
    const analyticsUtmSourceExpr = sql<string | null>`nullif(lower(coalesce(${analyticsEvent.payload}->>'utmSource', ${analyticsEvent.payload}->>'utm_source', '')), '')`;
    const analyticsUtmMediumExpr = sql<string | null>`nullif(lower(coalesce(${analyticsEvent.payload}->>'utmMedium', ${analyticsEvent.payload}->>'utm_medium', '')), '')`;
    const analyticsUtmCampaignExpr = sql<string | null>`nullif(lower(coalesce(${analyticsEvent.payload}->>'utmCampaign', ${analyticsEvent.payload}->>'utm_campaign', '')), '')`;
    const contactUtmSourceExpr = sql<string | null>`nullif(lower(coalesce(${contactFormSubmission.payload}->>'utmSource', ${contactFormSubmission.payload}->>'utm_source', '')), '')`;
    const contactUtmMediumExpr = sql<string | null>`nullif(lower(coalesce(${contactFormSubmission.payload}->>'utmMedium', ${contactFormSubmission.payload}->>'utm_medium', '')), '')`;
    const contactUtmCampaignExpr = sql<string | null>`nullif(lower(coalesce(${contactFormSubmission.payload}->>'utmCampaign', ${contactFormSubmission.payload}->>'utm_campaign', '')), '')`;
    const analyticsHasAttributionExpr = sql`${analyticsUtmSourceExpr} is not null or ${analyticsUtmMediumExpr} is not null or ${analyticsUtmCampaignExpr} is not null`;
    const contactHasAttributionExpr = sql`${contactUtmSourceExpr} is not null or ${contactUtmMediumExpr} is not null or ${contactUtmCampaignExpr} is not null`;

    const [
      totalsRows,
      dailyRows,
      topPagesRows,
      topReferrerRows,
      deviceRows,
      pageviewRows,
      contactTotalsRows,
      contactDailyRows,
      contactTopSourceRows,
      previousTotalsRows,
      previousContactTotalsRows,
      funnelRows,
      analyticsCampaignRows,
      contactCampaignRows,
    ] =
      await Promise.all([
        db
          .select({
            events: sql<number>`count(*)`,
            pageviews: sql<number>`count(*) filter (where ${analyticsEvent.eventType} = 'pageview')`,
            uniqueVisitors: sql<number>`count(distinct ${analyticsEvent.visitorIdHash})`,
            uniqueSessions: sql<number>`count(distinct ${analyticsEvent.sessionId})`,
          })
          .from(analyticsEvent)
          .where(rangeWhere),
        db
          .select({
            date: dayLabel,
            events: sql<number>`count(*)`,
            pageviews: sql<number>`count(*) filter (where ${analyticsEvent.eventType} = 'pageview')`,
            uniqueVisitors: sql<number>`count(distinct ${analyticsEvent.visitorIdHash})`,
            uniqueSessions: sql<number>`count(distinct ${analyticsEvent.sessionId})`,
          })
          .from(analyticsEvent)
          .where(rangeWhere)
          .groupBy(dayBucket)
          .orderBy(dayBucket),
        db
          .select({
            path: analyticsEvent.path,
            pageviews: sql<number>`count(*)`,
            uniqueVisitors: sql<number>`count(distinct ${analyticsEvent.visitorIdHash})`,
          })
          .from(analyticsEvent)
          .where(and(rangeWhere, eq(analyticsEvent.eventType, "pageview")))
          .groupBy(analyticsEvent.path)
          .orderBy(desc(sql<number>`count(*)`), analyticsEvent.path)
          .limit(8),
        db
          .select({
            referrerHost: analyticsEvent.referrerHost,
            events: sql<number>`count(*)`,
          })
          .from(analyticsEvent)
          .where(
            and(
              rangeWhere,
              isNotNull(analyticsEvent.referrerHost),
              sql`${analyticsEvent.referrerHost} <> ''`,
            ),
          )
          .groupBy(analyticsEvent.referrerHost)
          .orderBy(desc(sql<number>`count(*)`), analyticsEvent.referrerHost)
          .limit(8),
        db
          .select({
            deviceType: sql<string>`coalesce(${analyticsEvent.deviceType}, 'unknown')`,
            events: sql<number>`count(*)`,
          })
          .from(analyticsEvent)
          .where(rangeWhere)
          .groupBy(sql`coalesce(${analyticsEvent.deviceType}, 'unknown')`)
          .orderBy(desc(sql<number>`count(*)`)),
        db
          .select({
            id: analyticsEvent.id,
            sessionId: analyticsEvent.sessionId,
            visitorIdHash: analyticsEvent.visitorIdHash,
            path: analyticsEvent.path,
            countryCode: analyticsEvent.countryCode,
            createdAt: analyticsEvent.createdAt,
          })
          .from(analyticsEvent)
          .where(and(rangeWhere, eq(analyticsEvent.eventType, "pageview")))
          .orderBy(
            analyticsEvent.sessionId,
            analyticsEvent.createdAt,
            analyticsEvent.id,
          ),
        db
          .select({
            submissions: sql<number>`count(*)`,
            uniqueSourceHosts: sql<number>`count(distinct ${contactFormSubmission.sourceHost}) filter (where ${contactFormSubmission.sourceHost} is not null and ${contactFormSubmission.sourceHost} <> '')`,
          })
          .from(contactFormSubmission)
          .where(contactRangeWhere),
        db
          .select({
            date: contactDayLabel,
            submissions: sql<number>`count(*)`,
          })
          .from(contactFormSubmission)
          .where(contactRangeWhere)
          .groupBy(contactDayBucket)
          .orderBy(contactDayBucket),
        db
          .select({
            sourceHost: contactFormSubmission.sourceHost,
            submissions: sql<number>`count(*)`,
          })
          .from(contactFormSubmission)
          .where(
            and(
              contactRangeWhere,
              isNotNull(contactFormSubmission.sourceHost),
              sql`${contactFormSubmission.sourceHost} <> ''`,
            ),
          )
          .groupBy(contactFormSubmission.sourceHost)
          .orderBy(desc(sql<number>`count(*)`), contactFormSubmission.sourceHost)
          .limit(8),
        db
          .select({
            events: sql<number>`count(*)`,
            pageviews: sql<number>`count(*) filter (where ${analyticsEvent.eventType} = 'pageview')`,
            uniqueVisitors: sql<number>`count(distinct ${analyticsEvent.visitorIdHash})`,
            uniqueSessions: sql<number>`count(distinct ${analyticsEvent.sessionId})`,
          })
          .from(analyticsEvent)
          .where(previousRangeWhere),
        db
          .select({
            submissions: sql<number>`count(*)`,
          })
          .from(contactFormSubmission)
          .where(previousContactRangeWhere),
        db
          .select({
            formViews: sql<number>`count(*) filter (where ${analyticsEvent.eventType} = 'custom' and ${customEventNameExpr} in ('contact_form_view', 'form_view', 'contact_form_seen'))`,
            formStarts: sql<number>`count(*) filter (where ${analyticsEvent.eventType} = 'custom' and ${customEventNameExpr} in ('contact_form_start', 'form_start', 'contact_form_begin'))`,
          })
          .from(analyticsEvent)
          .where(rangeWhere),
        db
          .select({
            utmSource: analyticsUtmSourceExpr,
            utmMedium: analyticsUtmMediumExpr,
            utmCampaign: analyticsUtmCampaignExpr,
            pageviews: sql<number>`count(*)`,
          })
          .from(analyticsEvent)
          .where(
            and(
              rangeWhere,
              eq(analyticsEvent.eventType, "pageview"),
              analyticsHasAttributionExpr,
            ),
          )
          .groupBy(
            analyticsUtmSourceExpr,
            analyticsUtmMediumExpr,
            analyticsUtmCampaignExpr,
          )
          .orderBy(desc(sql<number>`count(*)`))
          .limit(50),
        db
          .select({
            utmSource: contactUtmSourceExpr,
            utmMedium: contactUtmMediumExpr,
            utmCampaign: contactUtmCampaignExpr,
            submissions: sql<number>`count(*)`,
          })
          .from(contactFormSubmission)
          .where(and(contactRangeWhere, contactHasAttributionExpr))
          .groupBy(
            contactUtmSourceExpr,
            contactUtmMediumExpr,
            contactUtmCampaignExpr,
          )
          .orderBy(desc(sql<number>`count(*)`))
          .limit(50),
      ]);

    const totalsRow = totalsRows[0] ?? {
      events: 0,
      pageviews: 0,
      uniqueVisitors: 0,
      uniqueSessions: 0,
    };
    const totals = {
      events: toCount(totalsRow.events),
      pageviews: toCount(totalsRow.pageviews),
      uniqueVisitors: toCount(totalsRow.uniqueVisitors),
      uniqueSessions: toCount(totalsRow.uniqueSessions),
      avgPagesPerSession:
        toCount(totalsRow.uniqueSessions) > 0
          ? roundToTwoDecimals(
              toCount(totalsRow.pageviews) / toCount(totalsRow.uniqueSessions),
            )
          : 0,
    };
    const previousTotalsRow = previousTotalsRows[0] ?? {
      events: 0,
      pageviews: 0,
      uniqueVisitors: 0,
      uniqueSessions: 0,
    };
    const previousTotals = {
      events: toCount(previousTotalsRow.events),
      pageviews: toCount(previousTotalsRow.pageviews),
      uniqueVisitors: toCount(previousTotalsRow.uniqueVisitors),
      uniqueSessions: toCount(previousTotalsRow.uniqueSessions),
      avgPagesPerSession:
        toCount(previousTotalsRow.uniqueSessions) > 0
          ? roundToTwoDecimals(
              toCount(previousTotalsRow.pageviews) /
                toCount(previousTotalsRow.uniqueSessions),
            )
          : 0,
    };

    const dailyRowByDate = new Map<string, {
      events: number;
      pageviews: number;
      uniqueVisitors: number;
      uniqueSessions: number;
    }>(
      dailyRows.map((row: {
        date: string;
        events: unknown;
        pageviews: unknown;
        uniqueVisitors: unknown;
        uniqueSessions: unknown;
      }) => [
        row.date,
        {
          events: toCount(row.events),
          pageviews: toCount(row.pageviews),
          uniqueVisitors: toCount(row.uniqueVisitors),
          uniqueSessions: toCount(row.uniqueSessions),
        },
      ]),
    );

    const daily = emptyDaily.map((bucket) => {
      const row = dailyRowByDate.get(bucket.date);
      if (!row) return bucket;
      return {
        ...bucket,
        ...row,
      };
    });

    const topPages = topPagesRows.map((row: {
      path: string;
      pageviews: unknown;
      uniqueVisitors: unknown;
    }) => ({
      path: row.path,
      pageviews: toCount(row.pageviews),
      uniqueVisitors: toCount(row.uniqueVisitors),
    }));

    const topReferrers = topReferrerRows.map((row: {
      referrerHost: string | null;
      events: unknown;
    }) => ({
      referrerHost: row.referrerHost || "direct",
      events: toCount(row.events),
    }));

    const deviceTotal = deviceRows.reduce(
      (sum: number, row: { events: unknown }) => sum + toCount(row.events),
      0,
    );
    const devices = deviceRows.map((row: {
      deviceType: string | null;
      events: unknown;
    }) => {
      const events = toCount(row.events);
      return {
        deviceType: row.deviceType || "unknown",
        events,
        share: deviceTotal > 0 ? roundToTwoDecimals((events / deviceTotal) * 100) : 0,
      };
    });

    const countryMap = new Map<
      string,
      {
        countryCode: string;
        pageviews: number;
        visitorIds: Set<string>;
        sessionIds: Set<string>;
      }
    >();
    const entryPageCounts = new Map<string, number>();
    const exitPageCounts = new Map<string, number>();
    const transitionCounts = new Map<
      string,
      {
        fromPath: string;
        toPath: string;
        transitions: number;
        uniqueSessions: number;
      }
    >();
    let sessionsWithPageviews = 0;
    let totalTransitions = 0;
    let currentSessionId: string | null = null;
    let currentSessionPaths: string[] = [];

    const finalizeSessionPaths = () => {
      if (currentSessionPaths.length === 0) return;
      const normalizedPaths: string[] = [];
      for (const path of currentSessionPaths) {
        const normalizedPath = path.trim() || "/";
        if (normalizedPaths[normalizedPaths.length - 1] !== normalizedPath) {
          normalizedPaths.push(normalizedPath);
        }
      }
      currentSessionPaths = [];
      if (normalizedPaths.length === 0) return;

      sessionsWithPageviews += 1;
      const entryPath = normalizedPaths[0]!;
      const exitPath = normalizedPaths[normalizedPaths.length - 1]!;
      entryPageCounts.set(entryPath, (entryPageCounts.get(entryPath) ?? 0) + 1);
      exitPageCounts.set(exitPath, (exitPageCounts.get(exitPath) ?? 0) + 1);

      const sessionTransitionKeys = new Set<string>();
      for (let index = 1; index < normalizedPaths.length; index += 1) {
        const fromPath = normalizedPaths[index - 1]!;
        const toPath = normalizedPaths[index]!;
        const key = `${fromPath}\u001f${toPath}`;
        const existingTransition = transitionCounts.get(key);
        if (existingTransition) {
          existingTransition.transitions += 1;
          if (!sessionTransitionKeys.has(key)) {
            existingTransition.uniqueSessions += 1;
          }
        } else {
          transitionCounts.set(key, {
            fromPath,
            toPath,
            transitions: 1,
            uniqueSessions: 1,
          });
        }
        sessionTransitionKeys.add(key);
        totalTransitions += 1;
      }
    };

    for (const row of pageviewRows) {
      const countryCode = normalizeCountryCode(row.countryCode);
      const existingCountry = countryMap.get(countryCode);
      if (existingCountry) {
        existingCountry.pageviews += 1;
        if (row.visitorIdHash) existingCountry.visitorIds.add(row.visitorIdHash);
        if (row.sessionId) existingCountry.sessionIds.add(row.sessionId);
      } else {
        countryMap.set(countryCode, {
          countryCode,
          pageviews: 1,
          visitorIds: row.visitorIdHash ? new Set([row.visitorIdHash]) : new Set(),
          sessionIds: row.sessionId ? new Set([row.sessionId]) : new Set(),
        });
      }

      const sessionId = (row.sessionId || "").trim();
      if (!sessionId) continue;
      if (currentSessionId !== sessionId) {
        finalizeSessionPaths();
        currentSessionId = sessionId;
      }
      currentSessionPaths.push(row.path);
    }
    finalizeSessionPaths();

    const countries = Array.from(countryMap.values())
      .sort((left, right) => {
        if (right.pageviews !== left.pageviews) return right.pageviews - left.pageviews;
        if (right.sessionIds.size !== left.sessionIds.size) {
          return right.sessionIds.size - left.sessionIds.size;
        }
        return left.countryCode.localeCompare(right.countryCode);
      })
      .slice(0, 12)
      .map((row) => ({
        countryCode: row.countryCode,
        pageviews: row.pageviews,
        uniqueVisitors: row.visitorIds.size,
        uniqueSessions: row.sessionIds.size,
        share:
          totals.pageviews > 0
            ? roundToTwoDecimals((row.pageviews / totals.pageviews) * 100)
            : 0,
      }));

    const topEntryPages = Array.from(entryPageCounts.entries())
      .sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return left[0].localeCompare(right[0]);
      })
      .slice(0, 8)
      .map(([path, sessions]) => ({
        path,
        sessions,
        share:
          sessionsWithPageviews > 0
            ? roundToTwoDecimals((sessions / sessionsWithPageviews) * 100)
            : 0,
      }));

    const topExitPages = Array.from(exitPageCounts.entries())
      .sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return left[0].localeCompare(right[0]);
      })
      .slice(0, 8)
      .map(([path, sessions]) => ({
        path,
        sessions,
        share:
          sessionsWithPageviews > 0
            ? roundToTwoDecimals((sessions / sessionsWithPageviews) * 100)
            : 0,
      }));

    const topTransitions = Array.from(transitionCounts.values())
      .sort((left, right) => {
        if (right.transitions !== left.transitions) {
          return right.transitions - left.transitions;
        }
        if (right.uniqueSessions !== left.uniqueSessions) {
          return right.uniqueSessions - left.uniqueSessions;
        }
        if (left.fromPath !== right.fromPath) {
          return left.fromPath.localeCompare(right.fromPath);
        }
        return left.toPath.localeCompare(right.toPath);
      })
      .slice(0, 12)
      .map((row) => ({
        ...row,
        share:
          totalTransitions > 0
            ? roundToTwoDecimals((row.transitions / totalTransitions) * 100)
            : 0,
      }));
    const pathAnalysis = {
      sessionsWithPageviews,
      totalTransitions,
      topEntryPages,
      topExitPages,
      topTransitions,
    };

    const contactTotalsRow = contactTotalsRows[0] ?? {
      submissions: 0,
      uniqueSourceHosts: 0,
    };
    const contactSubmissions = toCount(contactTotalsRow.submissions);
    const uniqueSourceHosts = toCount(contactTotalsRow.uniqueSourceHosts);
    const submissionRatePct =
      totals.pageviews > 0
        ? roundToTwoDecimals((contactSubmissions / totals.pageviews) * 100)
        : 0;
    const previousContactTotalsRow = previousContactTotalsRows[0] ?? {
      submissions: 0,
    };
    const previousContactSubmissions = toCount(previousContactTotalsRow.submissions);
    const previousSubmissionRatePct =
      previousTotals.pageviews > 0
        ? roundToTwoDecimals(
            (previousContactSubmissions / previousTotals.pageviews) * 100,
          )
        : 0;

    const contactDailyRowByDate = new Map<string, number>(
      contactDailyRows.map((row: {
        date: string;
        submissions: unknown;
      }) => [row.date, toCount(row.submissions)]),
    );
    const contactDaily = emptyContactDaily.map((row) => ({
      date: row.date,
      submissions: contactDailyRowByDate.get(row.date) ?? 0,
    }));
    const contactTopSourceHosts = contactTopSourceRows.map((row: {
      sourceHost: string | null;
      submissions: unknown;
    }) => ({
      sourceHost: row.sourceHost || "unknown",
      submissions: toCount(row.submissions),
    }));
    const comparison = {
      previousRangeStart,
      previousRangeEnd,
      totals: {
        pageviews: buildComparisonMetric(totals.pageviews, previousTotals.pageviews),
        uniqueVisitors: buildComparisonMetric(
          totals.uniqueVisitors,
          previousTotals.uniqueVisitors,
        ),
        uniqueSessions: buildComparisonMetric(
          totals.uniqueSessions,
          previousTotals.uniqueSessions,
        ),
        submissions: buildComparisonMetric(
          contactSubmissions,
          previousContactSubmissions,
        ),
        conversionRatePct: buildComparisonMetric(
          submissionRatePct,
          previousSubmissionRatePct,
        ),
      },
    };
    const funnelRow = funnelRows[0] ?? {
      formViews: 0,
      formStarts: 0,
    };
    const funnelBase = [
      { key: "pageviews" as const, label: "Pageviews", count: totals.pageviews },
      {
        key: "formViews" as const,
        label: "Form views",
        count: toCount(funnelRow.formViews),
      },
      {
        key: "formStarts" as const,
        label: "Form starts",
        count: toCount(funnelRow.formStarts),
      },
      { key: "submissions" as const, label: "Submissions", count: contactSubmissions },
    ];
    const firstFunnelCount = funnelBase[0]?.count ?? 0;
    const funnel = {
      pageviews: totals.pageviews,
      formViews: funnelBase[1]?.count ?? 0,
      formStarts: funnelBase[2]?.count ?? 0,
      submissions: contactSubmissions,
      steps: funnelBase.map((step, index) => {
        const previousCount =
          index === 0 ? firstFunnelCount : (funnelBase[index - 1]?.count ?? 0);
        return {
          ...step,
          conversionFromPreviousPct:
            index === 0
              ? firstFunnelCount > 0
                ? 100
                : 0
              : previousCount > 0
                ? roundToTwoDecimals((step.count / previousCount) * 100)
                : 0,
          conversionFromFirstPct:
            firstFunnelCount > 0
              ? roundToTwoDecimals((step.count / firstFunnelCount) * 100)
              : 0,
        };
      }),
    };
    type CampaignAggregate = {
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      pageviews: number;
      submissions: number;
    };
    const campaignMap = new Map<string, CampaignAggregate>();
    const makeCampaignKey = (
      utmSource: string | null,
      utmMedium: string | null,
      utmCampaign: string | null,
    ) => `${utmSource ?? ""}\u001f${utmMedium ?? ""}\u001f${utmCampaign ?? ""}`;

    for (const row of analyticsCampaignRows) {
      const key = makeCampaignKey(row.utmSource, row.utmMedium, row.utmCampaign);
      const existingRow = campaignMap.get(key);
      if (existingRow) {
        existingRow.pageviews += toCount(row.pageviews);
      } else {
        campaignMap.set(key, {
          utmSource: row.utmSource,
          utmMedium: row.utmMedium,
          utmCampaign: row.utmCampaign,
          pageviews: toCount(row.pageviews),
          submissions: 0,
        });
      }
    }
    for (const row of contactCampaignRows) {
      const key = makeCampaignKey(row.utmSource, row.utmMedium, row.utmCampaign);
      const existingRow = campaignMap.get(key);
      if (existingRow) {
        existingRow.submissions += toCount(row.submissions);
      } else {
        campaignMap.set(key, {
          utmSource: row.utmSource,
          utmMedium: row.utmMedium,
          utmCampaign: row.utmCampaign,
          pageviews: 0,
          submissions: toCount(row.submissions),
        });
      }
    }

    const campaigns = Array.from(campaignMap.values())
      .sort((left, right) => {
        if (right.pageviews !== left.pageviews) return right.pageviews - left.pageviews;
        if (right.submissions !== left.submissions) {
          return right.submissions - left.submissions;
        }
        return (
          normalizeAttributionLabel(left.utmCampaign, "").localeCompare(
            normalizeAttributionLabel(right.utmCampaign, ""),
          ) * -1
        );
      })
      .slice(0, 8)
      .map((row) => ({
        utmSource: normalizeAttributionLabel(row.utmSource, "(direct)"),
        utmMedium: normalizeAttributionLabel(row.utmMedium, "(none)"),
        utmCampaign: normalizeAttributionLabel(row.utmCampaign, "(none)"),
        pageviews: row.pageviews,
        submissions: row.submissions,
        submissionRatePct:
          row.pageviews > 0
            ? roundToTwoDecimals((row.submissions / row.pageviews) * 100)
            : 0,
      }));

    const sourceMap = new Map<
      string,
      { utmSource: string; pageviews: number; submissions: number }
    >();
    for (const row of campaignMap.values()) {
      const source = normalizeAttributionLabel(row.utmSource, "(direct)");
      const existingSource = sourceMap.get(source);
      if (existingSource) {
        existingSource.pageviews += row.pageviews;
        existingSource.submissions += row.submissions;
      } else {
        sourceMap.set(source, {
          utmSource: source,
          pageviews: row.pageviews,
          submissions: row.submissions,
        });
      }
    }

    const sources = Array.from(sourceMap.values())
      .sort((left, right) => {
        if (right.pageviews !== left.pageviews) return right.pageviews - left.pageviews;
        return right.submissions - left.submissions;
      })
      .slice(0, 8)
      .map((row) => ({
        utmSource: row.utmSource,
        pageviews: row.pageviews,
        submissions: row.submissions,
        submissionRatePct:
          row.pageviews > 0
            ? roundToTwoDecimals((row.submissions / row.pageviews) * 100)
            : 0,
      }));
    const attribution = {
      campaigns,
      sources,
    };

    return {
      pluginId: "analytics",
      enabled,
      rangeDays: options.rangeDays,
      rangeStart,
      rangeEnd,
      totals,
      daily,
      topPages,
      topReferrers,
      devices,
      countries,
      contactForm: {
        enabled: contactFormEnabled,
        submissions: contactSubmissions,
        uniqueSourceHosts,
        conversionRatePct: submissionRatePct,
        daily: contactDaily,
        topSourceHosts: contactTopSourceHosts,
      },
      comparison,
      funnel,
      attribution,
      pathAnalysis,
    };
  }

  async getAnalyticsInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<AnalyticsPluginInfoPayload> {
    const { scriptEndpoint, trackEndpoint } =
      await resolveAnalyticsPublicEndpoints();

    const [entitlement, existing] = await Promise.all([
      pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "analytics",
      }),
      projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "analytics",
      }),
    ]);

    const entitled = entitlement.state === "enabled";

    if (!existing) {
      return {
        pluginId: "analytics",
        entitled,
        entitlementState: entitlement.state,
        enabled: false,
        instanceId: null,
        status: null,
        publicToken: null,
        config: null,
        snippets: null,
        usage: buildUsage({
          scriptEndpoint,
          trackEndpoint,
          config: null,
        }),
        instructions: entitled
          ? [
              "Analytics entitlement is enabled, but no plugin instance exists yet for this project.",
              "Ask a super-admin to enable the Analytics plugin in the admin plugin settings for this installation.",
              "Then run `vivd plugins analytics info` again to get the project-specific snippet.",
            ]
          : [
              "Analytics plugin access is currently disabled for this project.",
              "Ask a super-admin to enable Analytics in the admin plugin settings for this installation.",
              "After access is enabled, run `vivd plugins analytics info` again to get install instructions.",
            ],
      };
    }

    const normalizedConfig = normalizeAnalyticsConfig(existing.configJson);
    const snippets = getAnalyticsSnippets(existing.publicToken, scriptEndpoint);

    if (existing.status !== "enabled") {
      return {
        pluginId: "analytics",
        entitled,
        entitlementState: entitlement.state,
        enabled: false,
        instanceId: existing.id,
        status: existing.status,
        publicToken: existing.publicToken,
        config: normalizedConfig,
        snippets,
        usage: buildUsage({
          scriptEndpoint,
          trackEndpoint,
          config: normalizedConfig,
        }),
        instructions: [
          "Analytics plugin instance exists but is disabled.",
          "Ask a super-admin to enable Analytics in the admin plugin settings for this installation.",
          "After enabling, keep the script snippet in the page head/body so pageview tracking can run.",
        ],
      };
    }

    if (!entitled) {
      return {
        pluginId: "analytics",
        entitled,
        entitlementState: entitlement.state,
        enabled: false,
        instanceId: existing.id,
        status: existing.status,
        publicToken: existing.publicToken,
        config: normalizedConfig,
        snippets,
        usage: buildUsage({
          scriptEndpoint,
          trackEndpoint,
          config: normalizedConfig,
        }),
        instructions: [
          "Analytics plugin instance exists, but entitlement is not enabled for this project.",
          "Ask a super-admin to enable Analytics in the admin plugin settings for this installation.",
          "Keep the snippet in place; tracking will resume once entitlement is enabled.",
        ],
      };
    }

    return {
      pluginId: "analytics",
      entitled,
      entitlementState: entitlement.state,
      enabled: true,
      instanceId: existing.id,
      status: existing.status,
      publicToken: existing.publicToken,
      config: normalizedConfig,
      snippets,
      usage: buildUsage({
        scriptEndpoint,
        trackEndpoint,
        config: normalizedConfig,
      }),
      instructions: [
        "Insert the provided analytics script snippet once per page template (preferably in <head> with async).",
        "Keep the token in the snippet unchanged; it maps events to this project.",
        `Script endpoint: ${scriptEndpoint}?token=<publicToken>`,
        `Track endpoint: ${trackEndpoint}`,
        normalizedConfig.enableClientTracking
          ? "Client tracking is enabled; pageview events are sent automatically."
          : "Client tracking is disabled; use manual calls to the track endpoint for controlled event capture.",
        "For funnel tracking, fire custom events when the contact form is viewed and when the user starts typing.",
        "Example: window.vivdAnalytics.track('custom', { eventName: 'contact_form_view', path: window.location.href })",
        "Example: window.vivdAnalytics.track('custom', { eventName: 'contact_form_start', path: window.location.href })",
        "UTM fields are captured from URL query params; include hidden form fields named utm_source/utm_medium/utm_campaign for submission attribution.",
        "Country analytics use proxy/CDN country headers when available; on generic self-host installs, run ./scripts/install-analytics-geoip.sh for the default free DB-IP Lite MMDB or mount a compatible country .mmdb at VIVD_ANALYTICS_GEOIP_DB_PATH.",
        "Verify installation by loading a page once and checking network requests to /plugins/analytics/v1/track.",
      ],
    };
  }

  private async toPayload(
    row: AnalyticsPluginInstanceRow,
    created: boolean,
  ): Promise<AnalyticsPluginPayload> {
    const { scriptEndpoint } = await resolveAnalyticsPublicEndpoints();
    const normalizedConfig = normalizeAnalyticsConfig(row.configJson);
    return {
      pluginId: "analytics",
      instanceId: row.id,
      status: row.status,
      created,
      publicToken: row.publicToken,
      config: normalizedConfig,
      snippets: getAnalyticsSnippets(row.publicToken, scriptEndpoint),
    };
  }
  }

  return new AnalyticsPluginService();
}

export type AnalyticsPluginService = ReturnType<
  typeof createAnalyticsPluginService
>;
export type {
  AnalyticsComparisonMetric,
  AnalyticsSummaryPayload,
} from "../shared/summary";
