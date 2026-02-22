import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../../../db";
import {
  analyticsEvent,
  contactFormSubmission,
  projectPluginInstance,
} from "../../../db/schema";
import { pluginEntitlementService } from "../PluginEntitlementService";
import {
  projectPluginInstanceService,
  type ProjectPluginInstanceRow,
} from "../core/instanceService";
import {
  analyticsPluginConfigSchema,
  type AnalyticsPluginConfig,
} from "./config";
import {
  getAnalyticsScriptEndpoint,
  getAnalyticsTrackEndpoint,
} from "./publicApi";
import { getAnalyticsSnippets } from "./snippets";

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

export interface AnalyticsSummaryPayload {
  pluginId: "analytics";
  enabled: boolean;
  rangeDays: 7 | 30;
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

function roundToTwoDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
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
    eventTypes: ["pageview"],
    respectDoNotTrack: config.respectDoNotTrack,
    captureQueryString: config.captureQueryString,
    enableClientTracking: config.enableClientTracking,
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

    return this.toPayload(row, created);
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
    return this.toPayload(existing, false);
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
      throw new Error(
        "Analytics plugin is not enabled for this project. Ask a super-admin to enable it first.",
      );
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

    if (updated) return this.toPayload(updated, false);

    return this.toPayload(
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
        contactForm: {
          enabled: contactFormEnabled,
          submissions: 0,
          uniqueSourceHosts: 0,
          conversionRatePct: 0,
          daily: emptyContactDaily,
          topSourceHosts: [],
        },
      };
    }

    const rangeWhere = and(
      eq(analyticsEvent.organizationId, options.organizationId),
      eq(analyticsEvent.projectSlug, options.projectSlug),
      eq(analyticsEvent.pluginInstanceId, existing.id),
      gte(analyticsEvent.createdAt, rangeStartDate),
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

    const [
      totalsRows,
      dailyRows,
      topPagesRows,
      topReferrerRows,
      deviceRows,
      contactTotalsRows,
      contactDailyRows,
      contactTopSourceRows,
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

    const dailyRowByDate = new Map(
      dailyRows.map((row) => [
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

    const topPages = topPagesRows.map((row) => ({
      path: row.path,
      pageviews: toCount(row.pageviews),
      uniqueVisitors: toCount(row.uniqueVisitors),
    }));

    const topReferrers = topReferrerRows.map((row) => ({
      referrerHost: row.referrerHost || "direct",
      events: toCount(row.events),
    }));

    const deviceTotal = deviceRows.reduce(
      (sum, row) => sum + toCount(row.events),
      0,
    );
    const devices = deviceRows.map((row) => {
      const events = toCount(row.events);
      return {
        deviceType: row.deviceType || "unknown",
        events,
        share: deviceTotal > 0 ? roundToTwoDecimals((events / deviceTotal) * 100) : 0,
      };
    });

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

    const contactDailyRowByDate = new Map(
      contactDailyRows.map((row) => [row.date, toCount(row.submissions)]),
    );
    const contactDaily = emptyContactDaily.map((row) => ({
      date: row.date,
      submissions: contactDailyRowByDate.get(row.date) ?? 0,
    }));
    const contactTopSourceHosts = contactTopSourceRows.map((row) => ({
      sourceHost: row.sourceHost || "unknown",
      submissions: toCount(row.submissions),
    }));

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
      contactForm: {
        enabled: contactFormEnabled,
        submissions: contactSubmissions,
        uniqueSourceHosts,
        conversionRatePct: submissionRatePct,
        daily: contactDaily,
        topSourceHosts: contactTopSourceHosts,
      },
    };
  }

  async getAnalyticsInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<AnalyticsPluginInfoPayload> {
    const scriptEndpoint = getAnalyticsScriptEndpoint();
    const trackEndpoint = getAnalyticsTrackEndpoint();

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
              "Ask a super-admin to enable the Analytics plugin in Super Admin -> Plugins.",
              "Then call vivd_plugins_analytics_info again to get the project-specific snippet.",
            ]
          : [
              "Analytics plugin access is currently disabled for this project.",
              "Ask a super-admin to enable Analytics in Super Admin -> Plugins.",
              "After access is enabled, call vivd_plugins_analytics_info again to get install instructions.",
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
          "Ask a super-admin to enable Analytics in Super Admin -> Plugins.",
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
          "Ask a super-admin to enable Analytics in Super Admin -> Plugins.",
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
        "Verify installation by loading a page once and checking network requests to /plugins/analytics/v1/track.",
      ],
    };
  }

  private toPayload(
    row: ProjectPluginInstanceRow,
    created: boolean,
  ): AnalyticsPluginPayload {
    const scriptEndpoint = getAnalyticsScriptEndpoint();
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

export const analyticsPluginService = new AnalyticsPluginService();
