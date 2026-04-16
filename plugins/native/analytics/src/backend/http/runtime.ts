import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { analyticsPluginConfigSchema } from "../config";
import { getAnalyticsTrackEndpoint } from "../publicApi";
import type { AnalyticsPublicRouterDeps } from "../ports";
import { createAnalyticsCountryResolver } from "./geolocation";

const DEFAULT_RATE_LIMIT_PER_TOKEN_PER_MINUTE = 240;

const eventTypeSchema = z.enum(["pageview", "custom"]);
const deviceTypeSchema = z.enum(["desktop", "mobile", "tablet", "bot", "unknown"]);

type UtmPayload = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
};

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeFieldValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
      if (typeof entry === "number" || typeof entry === "boolean") {
        return String(entry);
      }
    }
  }
  return "";
}

function readRequestFields(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const entries = Object.entries(body as Record<string, unknown>);
  return Object.fromEntries(entries.map(([key, value]) => [key, normalizeFieldValue(value)]));
}

function requestWantsJson(req: express.Request): boolean {
  if (req.is("application/json")) return true;

  const acceptHeader = (req.get("accept") || "").toLowerCase();
  if (!acceptHeader) return false;
  if (acceptHeader.includes("text/html")) return false;
  return acceptHeader.includes("application/json");
}

function sendSuccess(req: express.Request, res: express.Response) {
  if (requestWantsJson(req)) {
    return res.status(200).json({ ok: true });
  }
  return res.status(204).end();
}

function sendError(
  req: express.Request,
  res: express.Response,
  status: number,
  code: string,
  message: string,
) {
  if (requestWantsJson(req)) {
    return res.status(status).json({ ok: false, error: { code, message } });
  }

  return res.status(status).send(message);
}

function hashStableValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(rawPath: string, captureQueryString: boolean): string {
  const fallback = "/";
  const candidate = rawPath.trim();
  if (!candidate) return fallback;

  try {
    const url = new URL(candidate, "https://analytics.invalid");
    const pathname = (url.pathname || fallback).startsWith("/")
      ? url.pathname || fallback
      : `/${url.pathname || ""}`;
    if (!captureQueryString) return pathname;
    return `${pathname}${url.search || ""}`;
  } catch {
    const normalized = candidate.startsWith("/") ? candidate : `/${candidate}`;
    if (!captureQueryString) {
      const questionIndex = normalized.indexOf("?");
      return questionIndex >= 0 ? normalized.slice(0, questionIndex) || fallback : normalized;
    }
    return normalized;
  }
}

function isExcludedPath(pathValue: string, excludedPaths: string[]): boolean {
  const normalizedPath = (pathValue.split("?")[0] || "/").trim() || "/";

  for (const entry of excludedPaths) {
    const normalized = entry.trim();
    if (!normalized) continue;
    if (normalizedPath === normalized) return true;
    if (normalized !== "/" && normalizedPath.startsWith(`${normalized}/`)) return true;
  }
  return false;
}

function inferDeviceType(raw: string, userAgent: string): "desktop" | "mobile" | "tablet" | "bot" | "unknown" {
  const parsed = deviceTypeSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const ua = userAgent.toLowerCase();
  if (!ua) return "unknown";
  if (/bot|crawl|spider|slurp|headless/.test(ua)) return "bot";
  if (/tablet|ipad/.test(ua)) return "tablet";
  if (/mobile|iphone|android/.test(ua)) return "mobile";
  return "desktop";
}

function normalizeUtmValue(value: string): string | null {
  const normalized = value.trim().toLowerCase().slice(0, 128);
  return normalized || null;
}

function firstNonEmpty(...candidates: string[]): string {
  for (const candidate of candidates) {
    if (candidate.trim()) return candidate;
  }
  return "";
}

function readUtmFromFields(fields: Record<string, string>): UtmPayload {
  return {
    utmSource: normalizeUtmValue(
      firstNonEmpty(fields.utmSource || "", fields.utm_source || ""),
    ),
    utmMedium: normalizeUtmValue(
      firstNonEmpty(fields.utmMedium || "", fields.utm_medium || ""),
    ),
    utmCampaign: normalizeUtmValue(
      firstNonEmpty(fields.utmCampaign || "", fields.utm_campaign || ""),
    ),
    utmTerm: normalizeUtmValue(
      firstNonEmpty(fields.utmTerm || "", fields.utm_term || ""),
    ),
    utmContent: normalizeUtmValue(
      firstNonEmpty(fields.utmContent || "", fields.utm_content || ""),
    ),
  };
}

function readUtmFromPath(rawPath: string): UtmPayload {
  try {
    const url = new URL(rawPath || "/", "https://analytics.invalid");
    const readParam = (name: string) =>
      normalizeUtmValue(url.searchParams.get(name) || "");
    return {
      utmSource: readParam("utm_source"),
      utmMedium: readParam("utm_medium"),
      utmCampaign: readParam("utm_campaign"),
      utmTerm: readParam("utm_term"),
      utmContent: readParam("utm_content"),
    };
  } catch {
    return {
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    };
  }
}

function mergeUtmPayload(primary: UtmPayload, fallback: UtmPayload): UtmPayload {
  return {
    utmSource: primary.utmSource || fallback.utmSource,
    utmMedium: primary.utmMedium || fallback.utmMedium,
    utmCampaign: primary.utmCampaign || fallback.utmCampaign,
    utmTerm: primary.utmTerm || fallback.utmTerm,
    utmContent: primary.utmContent || fallback.utmContent,
  };
}

function normalizeEventName(raw: string): string | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return normalized || null;
}

function buildAnalyticsScript(options: {
  token: string;
  trackEndpoint: string;
  config: z.infer<typeof analyticsPluginConfigSchema>;
}): string {
  const scriptConfig = {
    token: options.token,
    trackEndpoint: options.trackEndpoint,
    respectDoNotTrack: options.config.respectDoNotTrack,
    captureQueryString: options.config.captureQueryString,
    excludedPaths: options.config.excludedPaths,
    enableClientTracking: options.config.enableClientTracking,
  };

  return `(() => {
  const config = ${JSON.stringify(scriptConfig)};
  const dnt = () => {
    const value = String(navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack || "").trim();
    return value === "1" || value.toLowerCase() === "yes";
  };

  const readStorage = (store, key) => {
    try {
      return store.getItem(key) || "";
    } catch {
      return "";
    }
  };

  const writeStorage = (store, key, value) => {
    try {
      store.setItem(key, value);
    } catch {
      // ignore storage failures
    }
  };

  const randomId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Math.random().toString(36).slice(2, 12);
  };

  const getVisitorId = () => {
    const key = "vivd_analytics_visitor_id";
    const existing = readStorage(window.localStorage, key);
    if (existing) return existing;
    const next = randomId();
    writeStorage(window.localStorage, key, next);
    return next;
  };

  const getSessionId = () => {
    const key = "vivd_analytics_session_id";
    const existing = readStorage(window.sessionStorage, key);
    if (existing) return existing;
    const next = randomId();
    writeStorage(window.sessionStorage, key, next);
    return next;
  };

  const detectDeviceType = () => {
    const ua = String(navigator.userAgent || "").toLowerCase();
    if (/bot|crawl|spider|slurp|headless/.test(ua)) return "bot";
    if (/tablet|ipad/.test(ua)) return "tablet";
    if (/mobile|iphone|android/.test(ua)) return "mobile";
    if (ua) return "desktop";
    return "unknown";
  };

  const readUtmParams = () => {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const read = (name) => String(params.get(name) || "").trim().toLowerCase().slice(0, 128);
      return {
        utmSource: read("utm_source"),
        utmMedium: read("utm_medium"),
        utmCampaign: read("utm_campaign"),
        utmTerm: read("utm_term"),
        utmContent: read("utm_content"),
      };
    } catch {
      return {
        utmSource: "",
        utmMedium: "",
        utmCampaign: "",
        utmTerm: "",
        utmContent: "",
      };
    }
  };

  const normalizePath = (rawPath) => {
    try {
      const parsed = new URL(rawPath || window.location.href, window.location.origin);
      const path = parsed.pathname || "/";
      if (!config.captureQueryString) return path;
      return path + (parsed.search || "");
    } catch {
      const fallback = window.location.pathname || "/";
      if (!config.captureQueryString) return fallback;
      return fallback + (window.location.search || "");
    }
  };

  const isExcluded = (path) => {
    if (!Array.isArray(config.excludedPaths) || config.excludedPaths.length === 0) return false;
    for (const rawEntry of config.excludedPaths) {
      const entry = String(rawEntry || "").trim();
      if (!entry) continue;
      if (path === entry) return true;
      if (entry !== "/" && path.indexOf(entry + "/") === 0) return true;
    }
    return false;
  };

  const sendPayload = (payload) => {
    const body = new URLSearchParams(payload);

    if (typeof navigator.sendBeacon === "function") {
      try {
        const accepted = navigator.sendBeacon(config.trackEndpoint, body);
        if (accepted) return;
      } catch {
        // continue to fetch fallback
      }
    }

    fetch(config.trackEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {
      // ignore network errors
    });
  };

  const basePayload = () => {
    let referrerHost = "";
    try {
      referrerHost = document.referrer ? new URL(document.referrer).host : "";
    } catch {
      referrerHost = "";
    }

    return {
      token: config.token,
      sourceHost: String(window.location.host || ""),
      referrerHost,
      visitorId: getVisitorId(),
      sessionId: getSessionId(),
      deviceType: detectDeviceType(),
      ...readUtmParams(),
    };
  };

  const track = (eventType, payload) => {
    if (!config.enableClientTracking) return;
    if (config.respectDoNotTrack && dnt()) return;

    const merged = {
      ...basePayload(),
      ...payload,
      eventType: String(eventType || "custom"),
    };

    const path = normalizePath(merged.path || window.location.href);
    if (isExcluded(path)) return;

    merged.path = path;
    sendPayload(merged);
  };

  const trackPageview = () => {
    track("pageview", {
      path: window.location.href,
    });
  };

  const existing = window.vivdAnalytics || {};
  window.vivdAnalytics = {
    ...existing,
    track: (eventType, payload = {}) => track(eventType, payload),
    trackPageview,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackPageview, { once: true });
  } else {
    trackPageview();
  }
})();`;
}

export function createAnalyticsPublicRouter(
  deps: AnalyticsPublicRouterDeps,
) {
  const {
    upload,
    db,
    tables,
    pluginEntitlementService,
    getPublicPluginApiBaseUrl,
    inferSourceHosts,
    hostUtils,
  } = deps;
  const { analyticsEvent, projectPluginInstance } = tables;
  const {
    extractSourceHostFromHeaders,
    isHostAllowed,
    normalizeHostCandidate,
  } = hostUtils;
  const countryResolver = createAnalyticsCountryResolver();
  const router = express.Router();
  const formParser = express.urlencoded({ extended: false, limit: "128kb" });
  const jsonParser = express.json({ limit: "128kb" });

  router.get("/analytics/v1/script.js", async (req, res) => {
    const token = String(req.query.token || "").trim();
    if (!token) {
      return res
        .status(400)
        .set("content-type", "application/javascript; charset=utf-8")
        .send("console.warn('Vivd analytics: missing token');");
    }

    const pluginInstance = await db.query.projectPluginInstance.findFirst({
      where: and(
        eq(projectPluginInstance.publicToken, token),
        eq(projectPluginInstance.pluginId, "analytics"),
        eq(projectPluginInstance.status, "enabled"),
      ),
    });

    if (!pluginInstance) {
      return res
        .status(404)
        .set("content-type", "application/javascript; charset=utf-8")
        .send("console.warn('Vivd analytics: invalid token');");
    }

    const entitlement = await pluginEntitlementService.resolveEffectiveEntitlement({
      organizationId: pluginInstance.organizationId,
      projectSlug: pluginInstance.projectSlug,
      pluginId: "analytics",
    });

    if (entitlement.state !== "enabled") {
      return res
        .status(403)
        .set("content-type", "application/javascript; charset=utf-8")
        .send("console.warn('Vivd analytics: plugin not entitled');");
    }

    const configResult = analyticsPluginConfigSchema.safeParse(
      pluginInstance.configJson ?? {},
    );
    const config = configResult.success
      ? configResult.data
      : analyticsPluginConfigSchema.parse({});
    const trackEndpoint = getAnalyticsTrackEndpoint(
      await getPublicPluginApiBaseUrl(),
    );

    const script = buildAnalyticsScript({
      token,
      trackEndpoint,
      config,
    });

    res.set("content-type", "application/javascript; charset=utf-8");
    res.set("cache-control", "public, max-age=300, stale-while-revalidate=300");
    return res.status(200).send(script);
  });

  router.post(
    "/analytics/v1/track",
    upload.none(),
    formParser,
    jsonParser,
    async (req, res) => {
      const fields = readRequestFields(req.body);
      const token = fields.token;
      if (!token) {
        return sendError(req, res, 400, "missing_token", "token is required");
      }

      const pluginInstance = await db.query.projectPluginInstance.findFirst({
        where: and(
          eq(projectPluginInstance.publicToken, token),
          eq(projectPluginInstance.pluginId, "analytics"),
          eq(projectPluginInstance.status, "enabled"),
        ),
      });

      if (!pluginInstance) {
        return sendError(req, res, 404, "invalid_token", "plugin token not found");
      }

      const entitlement = await pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        pluginId: "analytics",
      });
      if (entitlement.state !== "enabled") {
        return sendError(
          req,
          res,
          403,
          "plugin_not_entitled",
          "analytics is not enabled for this project",
        );
      }

      const configResult = analyticsPluginConfigSchema.safeParse(
        pluginInstance.configJson ?? {},
      );
      const config = configResult.success
        ? configResult.data
        : analyticsPluginConfigSchema.parse({});

      const sourceHostFromHeaders = extractSourceHostFromHeaders({
        origin: req.get("origin"),
        referer: req.get("referer"),
      });
      const requestedSourceHost = normalizeHostCandidate(fields.sourceHost);
      const sourceHost = requestedSourceHost || sourceHostFromHeaders;

      const inferredSourceHosts = await inferSourceHosts({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
      });
      if (!isHostAllowed(sourceHost, inferredSourceHosts)) {
        return sendError(req, res, 403, "forbidden_source", "source host not allowed");
      }

      const eventTypeResult = eventTypeSchema.safeParse(fields.eventType || "pageview");
      if (!eventTypeResult.success) {
        return sendError(req, res, 400, "invalid_payload", "invalid event type");
      }
      const eventType = eventTypeResult.data;

      const rawPath = fields.path || "/";
      const normalizedPath = normalizePath(rawPath, config.captureQueryString);
      if (isExcludedPath(normalizedPath, config.excludedPaths)) {
        return sendSuccess(req, res);
      }

      const rateLimitPerTokenPerMinute = readPositiveIntEnv(
        "VIVD_ANALYTICS_RATE_LIMIT_PER_TOKEN_PER_MINUTE",
        DEFAULT_RATE_LIMIT_PER_TOKEN_PER_MINUTE,
      );
      if (rateLimitPerTokenPerMinute > 0) {
        const minuteStart = new Date(Date.now() - 60_000);
        const rateRows = await db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(analyticsEvent)
          .where(
            and(
              eq(analyticsEvent.pluginInstanceId, pluginInstance.id),
              gte(analyticsEvent.createdAt, minuteStart),
            ),
          );
        const minuteCount = Number(rateRows[0]?.count ?? 0);
        if (minuteCount >= rateLimitPerTokenPerMinute) {
          return sendError(
            req,
            res,
            429,
            "rate_limited",
            "Too many analytics events. Please retry shortly.",
          );
        }
      }

      if (
        entitlement.hardStop &&
        typeof entitlement.monthlyEventLimit === "number" &&
        entitlement.monthlyEventLimit >= 0
      ) {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);

        const currentMonthRows = await db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(analyticsEvent)
          .where(
            and(
              eq(analyticsEvent.organizationId, pluginInstance.organizationId),
              entitlement.scope === "organization" || entitlement.scope === "instance"
                ? undefined
                : eq(analyticsEvent.projectSlug, pluginInstance.projectSlug),
              gte(analyticsEvent.createdAt, monthStart),
            ),
          );
        const currentMonthCount = Number(currentMonthRows[0]?.count ?? 0);
        if (currentMonthCount >= entitlement.monthlyEventLimit) {
          return sendError(
            req,
            res,
            429,
            "plugin_quota_exceeded",
            "monthly analytics event limit reached",
          );
        }
      }

      const referrerHost = normalizeHostCandidate(fields.referrerHost) || null;
      const visitorIdRaw = fields.visitorId || "";
      const visitorIdHash = visitorIdRaw ? hashStableValue(visitorIdRaw) : null;
      const sessionId = (fields.sessionId || "").slice(0, 128) || null;
      const userAgent = (req.get("user-agent") || "").slice(0, 512);
      const deviceType = inferDeviceType(fields.deviceType, userAgent);
      const eventName = normalizeEventName(
        firstNonEmpty(
          fields.eventName || "",
          fields.event || "",
          fields.name || "",
        ),
      );
      const utmPayload = mergeUtmPayload(
        readUtmFromFields(fields),
        readUtmFromPath(rawPath),
      );
      const normalizedCountryCode = await countryResolver.resolveCountryCode(
        req,
        fields.countryCode || "",
      );

      const payload: Record<string, unknown> = {};
      if (config.captureQueryString && rawPath.includes("?")) {
        payload.queryString = rawPath.slice(rawPath.indexOf("?"));
      }
      if (userAgent) {
        payload.userAgent = userAgent;
      }
      if (eventName) {
        payload.eventName = eventName;
      }
      if (utmPayload.utmSource) {
        payload.utmSource = utmPayload.utmSource;
      }
      if (utmPayload.utmMedium) {
        payload.utmMedium = utmPayload.utmMedium;
      }
      if (utmPayload.utmCampaign) {
        payload.utmCampaign = utmPayload.utmCampaign;
      }
      if (utmPayload.utmTerm) {
        payload.utmTerm = utmPayload.utmTerm;
      }
      if (utmPayload.utmContent) {
        payload.utmContent = utmPayload.utmContent;
      }

      await db.insert(analyticsEvent).values({
        id: randomUUID(),
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        pluginInstanceId: pluginInstance.id,
        eventType,
        path: normalizedPath,
        referrerHost,
        sourceHost,
        visitorIdHash,
        sessionId,
        deviceType,
        countryCode: normalizedCountryCode,
        payload,
        createdAt: new Date(),
      });

      return sendSuccess(req, res);
    },
  );

  return router;
}
