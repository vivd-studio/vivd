import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  newsletterPluginConfigSchema,
  type NewsletterPluginConfig,
} from "./config";
import {
  getNewsletterConfirmEndpoint,
  getNewsletterSubscribeEndpoint,
  getNewsletterUnsubscribeEndpoint,
} from "./publicApi";
import { getNewsletterSnippets } from "./snippets";
import type {
  NewsletterConfirmByTokenResult,
  NewsletterPluginInstanceRow,
  NewsletterPluginServiceDeps,
  NewsletterSubscribeInput,
  NewsletterSubscriberMutationResult,
  NewsletterUnsubscribeByTokenResult,
} from "./ports";
import type {
  NewsletterSubscribersPayload,
  NewsletterSummaryPayload,
} from "../shared/summary";

const confirmEmailSchema = z.string().trim().email();
const CONFIRM_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
const UNSUBSCRIBE_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const TOKEN_RATE_LIMIT_PER_MINUTE = 30;
const IP_RATE_LIMIT_PER_HOUR = 25;

type NewsletterStatus =
  | "pending"
  | "confirmed"
  | "unsubscribed"
  | "bounced"
  | "complained";

function normalizeNewsletterConfig(configJson: unknown): NewsletterPluginConfig {
  const parsed = newsletterPluginConfigSchema.safeParse(configJson ?? {});
  if (parsed.success) return parsed.data;
  return newsletterPluginConfigSchema.parse({});
}

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeName(value: string | null | undefined): string | null {
  const normalized = (value || "").trim().slice(0, 120);
  return normalized || null;
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashClientIp(value: string | null | undefined): string | null {
  const normalized = (value || "").trim();
  if (!normalized) return null;
  return hashToken(normalized);
}

function createRawToken(): string {
  return randomBytes(24).toString("hex");
}

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toCount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stripDefaultPort(host: string): string {
  if (host.endsWith(":80")) return host.slice(0, -3);
  if (host.endsWith(":443")) return host.slice(0, -4);
  return host;
}

function normalizeHostWithUtils(
  raw: string | null | undefined,
  deps: NewsletterPluginServiceDeps,
): string | null {
  return deps.hostUtils.normalizeHostCandidate(raw);
}

function normalizeHostAllowlist(
  values: string[],
  deps: NewsletterPluginServiceDeps,
): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeHostWithUtils(value, deps))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function resolveEffectiveSourceHosts(
  config: NewsletterPluginConfig,
  inferredSourceHosts: string[],
  deps: NewsletterPluginServiceDeps,
): string[] {
  const configured = normalizeHostAllowlist(config.sourceHosts, deps);
  if (configured.length > 0) return configured;
  return normalizeHostAllowlist(inferredSourceHosts, deps);
}

function resolveEffectiveRedirectHosts(
  config: NewsletterPluginConfig,
  effectiveSourceHosts: string[],
  deps: NewsletterPluginServiceDeps,
): string[] {
  const configured = normalizeHostAllowlist(config.redirectHostAllowlist, deps);
  if (configured.length > 0) return configured;
  return effectiveSourceHosts;
}

function resolveRedirectTarget(
  rawRedirect: string | null | undefined,
  allowlist: string[],
  deps: NewsletterPluginServiceDeps,
): string | null {
  const candidate = (rawRedirect || "").trim();
  if (!candidate || allowlist.length === 0) return null;

  try {
    const url = new URL(candidate);
    const host = normalizeHostWithUtils(url.host, deps);
    if (!deps.hostUtils.isHostAllowed(host, allowlist)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function resolveDefaultSuccessRedirectTarget(options: {
  rawReferer?: string | null;
  rawOrigin?: string | null;
  allowlist: string[];
  deps: NewsletterPluginServiceDeps;
}): string | null {
  if (options.allowlist.length === 0) return null;

  for (const rawCandidate of [options.rawReferer, options.rawOrigin]) {
    const candidate = (rawCandidate || "").trim();
    if (!candidate) continue;

    try {
      const url = new URL(candidate);
      const host = normalizeHostWithUtils(url.host, options.deps);
      if (!options.deps.hostUtils.isHostAllowed(host, options.allowlist)) {
        continue;
      }
      url.searchParams.set("newsletter", "success");
      url.searchParams.set("_vivd_newsletter", "success");
      return url.toString();
    } catch {
      continue;
    }
  }

  return null;
}

function withRedirectParam(url: string, redirectTarget: string | null): string {
  if (!redirectTarget) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("redirect", redirectTarget);
  return parsed.toString();
}

function parseRefererParts(
  rawReferer: string | null | undefined,
): {
  host: string | null;
  path: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
} {
  const candidate = (rawReferer || "").trim();
  if (!candidate) {
    return {
      host: null,
      path: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    };
  }

  try {
    const url = new URL(candidate);
    return {
      host: stripDefaultPort(url.host),
      path: `${url.pathname || "/"}${url.search || ""}`,
      utmSource: url.searchParams.get("utm_source"),
      utmMedium: url.searchParams.get("utm_medium"),
      utmCampaign: url.searchParams.get("utm_campaign"),
    };
  } catch {
    return {
      host: null,
      path: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    };
  }
}

export class NewsletterPluginNotEnabledError extends Error {
  constructor() {
    super(
      "Newsletter plugin is not enabled for this project. Ask a super-admin to enable it first.",
    );
    this.name = "NewsletterPluginNotEnabledError";
  }
}

export class NewsletterSubscriberNotFoundError extends Error {
  constructor(email: string) {
    super(`Subscriber not found: ${email}`);
    this.name = "NewsletterSubscriberNotFoundError";
  }
}

export class NewsletterSubscriberSuppressedError extends Error {
  constructor(email: string) {
    super(`Subscriber cannot be reactivated automatically: ${email}`);
    this.name = "NewsletterSubscriberSuppressedError";
  }
}

export class NewsletterConfirmationDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterConfirmationDeliveryError";
  }
}

export class NewsletterSignupRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterSignupRateLimitError";
  }
}

export class NewsletterSignupSourceHostError extends Error {
  constructor() {
    super("Newsletter signup source host is not allowed for this project.");
    this.name = "NewsletterSignupSourceHostError";
  }
}

async function readProjectTitle(
  deps: NewsletterPluginServiceDeps,
  options: {
    organizationId: string;
    projectSlug: string;
  },
): Promise<string> {
  const row = await deps.db.query.projectMeta?.findFirst?.({
    where: and(
      eq(deps.tables.projectMeta.organizationId, options.organizationId),
      eq(deps.tables.projectMeta.slug, options.projectSlug),
    ),
    columns: {
      title: true,
    },
  });

  const title = row?.title?.trim?.();
  return title || options.projectSlug;
}

async function countRecentRequests(options: {
  deps: NewsletterPluginServiceDeps;
  pluginInstanceId: string;
  since: Date;
  ipHash: string | null;
}) {
  const tokenRows = await options.deps.db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(options.deps.tables.newsletterSubscriber)
    .where(
      and(
        eq(
          options.deps.tables.newsletterSubscriber.pluginInstanceId,
          options.pluginInstanceId,
        ),
        gte(options.deps.tables.newsletterSubscriber.updatedAt, options.since),
      ),
    );

  const ipRows =
    options.ipHash
      ? await options.deps.db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(options.deps.tables.newsletterSubscriber)
          .where(
            and(
              eq(
                options.deps.tables.newsletterSubscriber.pluginInstanceId,
                options.pluginInstanceId,
              ),
              eq(options.deps.tables.newsletterSubscriber.lastIpHash, options.ipHash),
              gte(options.deps.tables.newsletterSubscriber.updatedAt, options.since),
            ),
          )
      : [];

  return {
    tokenCount: toCount(tokenRows[0]?.count),
    ipCount: toCount(ipRows[0]?.count),
  };
}

export function createNewsletterPluginService(deps: NewsletterPluginServiceDeps) {
  const {
    db,
    tables,
    pluginEntitlementService,
    projectPluginInstanceService,
    getPublicPluginApiBaseUrl,
    inferSourceHosts,
    hostUtils,
    emailDeliveryService,
    emailTemplates,
  } = deps;
  const { newsletterSubscriber, newsletterActionToken, projectPluginInstance } =
    tables;

  async function resolvePublicEndpoints() {
    const baseUrl = await getPublicPluginApiBaseUrl();
    return {
      subscribeEndpoint: getNewsletterSubscribeEndpoint(baseUrl),
      confirmEndpoint: getNewsletterConfirmEndpoint(baseUrl),
      unsubscribeEndpoint: getNewsletterUnsubscribeEndpoint(baseUrl),
    };
  }

  async function loadPluginInstanceByToken(token: string) {
    return db.query.projectPluginInstance.findFirst({
      where: and(
        eq(projectPluginInstance.publicToken, token),
        eq(projectPluginInstance.pluginId, "newsletter"),
        eq(projectPluginInstance.status, "enabled"),
      ),
    });
  }

  async function findSubscriberByEmail(options: {
    organizationId: string;
    projectSlug: string;
    email: string;
  }) {
    const normalizedEmail = normalizeEmailAddress(options.email);
    return db.query.newsletterSubscriber.findFirst({
      where: and(
        eq(newsletterSubscriber.organizationId, options.organizationId),
        eq(newsletterSubscriber.projectSlug, options.projectSlug),
        eq(newsletterSubscriber.emailNormalized, normalizedEmail),
      ),
    });
  }

  async function rotateActionTokens(options: {
    subscriberId: string;
    organizationId: string;
    projectSlug: string;
  }) {
    const confirmToken = createRawToken();
    const unsubscribeToken = createRawToken();
    const now = new Date();

    await db
      .delete(newsletterActionToken)
      .where(eq(newsletterActionToken.subscriberId, options.subscriberId));

    await db.insert(newsletterActionToken).values([
      {
        id: randomUUID(),
        subscriberId: options.subscriberId,
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        kind: "confirm",
        tokenHash: hashToken(confirmToken),
        expiresAt: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS),
        usedAt: null,
      },
      {
        id: randomUUID(),
        subscriberId: options.subscriberId,
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        kind: "unsubscribe",
        tokenHash: hashToken(unsubscribeToken),
        expiresAt: new Date(now.getTime() + UNSUBSCRIBE_TOKEN_TTL_MS),
        usedAt: null,
      },
    ]);

    return {
      confirmToken,
      unsubscribeToken,
    };
  }

  async function getSubscriberCounts(options: {
    organizationId: string;
    projectSlug: string;
  }) {
    const rows = await db
      .select({
        status: newsletterSubscriber.status,
        count: sql<number>`count(*)`,
      })
      .from(newsletterSubscriber)
      .where(
        and(
          eq(newsletterSubscriber.organizationId, options.organizationId),
          eq(newsletterSubscriber.projectSlug, options.projectSlug),
        ),
      )
      .groupBy(newsletterSubscriber.status);

    const counts = {
      total: 0,
      pending: 0,
      confirmed: 0,
      unsubscribed: 0,
      bounced: 0,
      complained: 0,
    };

    for (const row of rows as Array<{ status: NewsletterStatus; count: number }>) {
      const count = toCount(row.count);
      counts.total += count;
      if (row.status === "pending") counts.pending += count;
      if (row.status === "confirmed") counts.confirmed += count;
      if (row.status === "unsubscribed") counts.unsubscribed += count;
      if (row.status === "bounced") counts.bounced += count;
      if (row.status === "complained") counts.complained += count;
    }

    return counts;
  }

  async function buildInfoPayload(options: {
    organizationId: string;
    projectSlug: string;
    existing: NewsletterPluginInstanceRow | null;
  }) {
    const [entitlement, inferredSourceHosts, endpoints, counts] = await Promise.all([
      pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "newsletter",
      }),
      inferSourceHosts({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
      }),
      resolvePublicEndpoints(),
      getSubscriberCounts({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
      }),
    ]);

    const enabled =
      entitlement.state === "enabled" &&
      options.existing?.status === "enabled";
    const config = options.existing
      ? normalizeNewsletterConfig(options.existing.configJson)
      : null;
    const snippets =
      options.existing && config
        ? getNewsletterSnippets(
            options.existing.publicToken,
            endpoints.subscribeEndpoint,
            config,
          )
        : null;
    const effectiveSourceHosts = config
      ? resolveEffectiveSourceHosts(config, inferredSourceHosts, deps)
      : normalizeHostAllowlist(inferredSourceHosts, deps);

    return {
      entitled: entitlement.state === "enabled",
      entitlementState: entitlement.state,
      enabled,
      instanceId: options.existing?.id ?? null,
      status: options.existing?.status ?? null,
      publicToken: options.existing?.publicToken ?? null,
      config,
      snippets,
      usage: {
        subscribeEndpoint: endpoints.subscribeEndpoint,
        confirmEndpoint: endpoints.confirmEndpoint,
        unsubscribeEndpoint: endpoints.unsubscribeEndpoint,
        expectedFields: config?.collectName ? ["token", "name", "email"] : ["token", "email"],
        optionalFields: ["_redirect", "_honeypot"],
        inferredAutoSourceHosts: effectiveSourceHosts,
      },
      details: {
        counts,
      },
      instructions: [
        "Newsletter signups always use double opt-in in this v1.",
        "Install the generated HTML or Astro snippet and keep the hidden token field unchanged.",
        "Export confirmed subscribers from the project page or with `vivd plugins read newsletter subscribers`.",
      ],
    };
  }

  async function sendConfirmationEmail(options: {
    organizationId: string;
    projectSlug: string;
    subscriberId: string;
    email: string;
    redirectTarget: string | null;
    recipientName?: string | null;
    mode: "newsletter" | "waitlist";
  }) {
    const [endpoints, projectTitle, tokens] = await Promise.all([
      resolvePublicEndpoints(),
      readProjectTitle(deps, options),
      rotateActionTokens({
        subscriberId: options.subscriberId,
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
      }),
    ]);

    const confirmUrl = withRedirectParam(
      `${endpoints.confirmEndpoint}?token=${encodeURIComponent(tokens.confirmToken)}`,
      options.redirectTarget,
    );
    const unsubscribeUrl = withRedirectParam(
      `${endpoints.unsubscribeEndpoint}?token=${encodeURIComponent(tokens.unsubscribeToken)}`,
      options.redirectTarget,
    );
    const email = await emailTemplates.buildConfirmationEmail({
      projectTitle,
      recipientName: options.recipientName,
      confirmUrl,
      unsubscribeUrl,
      expiresInSeconds: Math.floor(CONFIRM_TOKEN_TTL_MS / 1000),
      mode: options.mode,
    });

    const result = await emailDeliveryService.send({
      to: [options.email],
      subject: email.subject,
      text: email.text,
      html: email.html,
      metadata: {
        category: "newsletter.confirmation",
        plugin: "newsletter",
        organization: options.organizationId,
        project: options.projectSlug,
      },
    });

    if (!result.accepted) {
      throw new NewsletterConfirmationDeliveryError(
        result.error || "Failed to send confirmation email.",
      );
    }
  }

  class NewsletterPluginServiceImpl {
    async ensureNewsletterPlugin(options: {
      organizationId: string;
      projectSlug: string;
    }) {
      const { row, created } =
        await projectPluginInstanceService.ensurePluginInstance({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginId: "newsletter",
        });

      const config = normalizeNewsletterConfig(row.configJson);
      const endpoints = await resolvePublicEndpoints();
      return {
        pluginId: "newsletter" as const,
        instanceId: row.id,
        status: row.status,
        created,
        publicToken: row.publicToken,
        config,
        snippets: getNewsletterSnippets(
          row.publicToken,
          endpoints.subscribeEndpoint,
          config,
        ),
      };
    }

    async getNewsletterInfo(options: {
      organizationId: string;
      projectSlug: string;
    }) {
      const existing = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "newsletter",
      });

      return buildInfoPayload({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        existing,
      });
    }

    async updateNewsletterConfig(options: {
      organizationId: string;
      projectSlug: string;
      config: NewsletterPluginConfig;
    }) {
      const entitlement = await pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "newsletter",
      });
      if (entitlement.state !== "enabled") {
        throw new NewsletterPluginNotEnabledError();
      }

      const parsedConfig = newsletterPluginConfigSchema.parse(options.config);
      const { row } = await projectPluginInstanceService.ensurePluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "newsletter",
      });

      const updated = await projectPluginInstanceService.updatePluginInstance({
        instanceId: row.id,
        configJson: parsedConfig,
        status: "enabled",
        updatedAt: new Date(),
      });

      return buildInfoPayload({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        existing:
          updated ??
          ({
            ...row,
            status: "enabled",
            configJson: parsedConfig,
          } satisfies NewsletterPluginInstanceRow),
      });
    }

    async subscribe(options: NewsletterSubscribeInput): Promise<{
      redirectTarget: string | null;
      result: NewsletterSubscriberMutationResult;
    }> {
      const email = confirmEmailSchema.parse(options.email);
      const pluginInstance = await loadPluginInstanceByToken(options.token);
      if (!pluginInstance) {
        throw new NewsletterPluginNotEnabledError();
      }

      const [entitlement, inferredSourceHosts] = await Promise.all([
        pluginEntitlementService.resolveEffectiveEntitlement({
          organizationId: pluginInstance.organizationId,
          projectSlug: pluginInstance.projectSlug,
          pluginId: "newsletter",
        }),
        inferSourceHosts({
          organizationId: pluginInstance.organizationId,
          projectSlug: pluginInstance.projectSlug,
        }),
      ]);
      if (entitlement.state !== "enabled") {
        throw new NewsletterPluginNotEnabledError();
      }

      const config = normalizeNewsletterConfig(pluginInstance.configJson);
      const effectiveSourceHosts = resolveEffectiveSourceHosts(
        config,
        inferredSourceHosts,
        deps,
      );
      if (
        !hostUtils.isHostAllowed(
          options.sourceHost,
          effectiveSourceHosts,
        )
      ) {
        throw new NewsletterSignupSourceHostError();
      }

      const effectiveRedirectHosts = resolveEffectiveRedirectHosts(
        config,
        effectiveSourceHosts,
        deps,
      );
      const redirectTarget =
        resolveRedirectTarget(options.redirect, effectiveRedirectHosts, deps) ??
        resolveDefaultSuccessRedirectTarget({
          rawReferer: options.referer,
          rawOrigin: options.origin,
          allowlist: effectiveRedirectHosts,
          deps,
        });

      const ipHash = hashClientIp(options.clientIp);
      const now = new Date();
      const [perMinute, perHour] = await Promise.all([
        countRecentRequests({
          deps,
          pluginInstanceId: pluginInstance.id,
          since: new Date(now.getTime() - 60_000),
          ipHash,
        }),
        countRecentRequests({
          deps,
          pluginInstanceId: pluginInstance.id,
          since: new Date(now.getTime() - 60 * 60_000),
          ipHash,
        }),
      ]);
      if (perMinute.tokenCount >= TOKEN_RATE_LIMIT_PER_MINUTE) {
        throw new NewsletterSignupRateLimitError(
          "Too many signup attempts for this project. Please try again shortly.",
        );
      }
      if (ipHash && perHour.ipCount >= IP_RATE_LIMIT_PER_HOUR) {
        throw new NewsletterSignupRateLimitError(
          "Too many signup attempts from this source. Please try again later.",
        );
      }

      const refererParts = parseRefererParts(options.referer);
      const existing = await findSubscriberByEmail({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        email,
      });

      if (existing?.status === "confirmed") {
        return {
          redirectTarget,
          result: {
            email,
            status: "already_confirmed",
          },
        };
      }

      if (
        existing &&
        (existing.status === "bounced" || existing.status === "complained")
      ) {
        throw new NewsletterSubscriberSuppressedError(email);
      }

      if (
        existing?.status === "pending" &&
        existing.lastConfirmationSentAt instanceof Date &&
        now.getTime() - existing.lastConfirmationSentAt.getTime() < RESEND_COOLDOWN_MS
      ) {
        return {
          redirectTarget,
          result: {
            email,
            status: "pending_cooldown",
          },
        };
      }

      const nextName = config.collectName
        ? normalizeName(options.name)
        : null;
      const subscriber =
        existing
          ? (
              await db
                .update(newsletterSubscriber)
                .set({
                  name: nextName,
                  status: "pending",
                  sourceHost: options.sourceHost,
                  sourcePath: refererParts.path,
                  referrerHost: refererParts.host,
                  utmSource: refererParts.utmSource,
                  utmMedium: refererParts.utmMedium,
                  utmCampaign: refererParts.utmCampaign,
                  lastIpHash: ipHash,
                  lastConfirmationSentAt: now,
                  lastSignupAt:
                    existing.status === "unsubscribed" ? now : existing.lastSignupAt,
                  confirmedAt: null,
                  unsubscribedAt: null,
                  updatedAt: now,
                })
                .where(eq(newsletterSubscriber.id, existing.id))
                .returning()
            )[0] ?? existing
          : (
              await db
                .insert(newsletterSubscriber)
                .values({
                  id: randomUUID(),
                  organizationId: pluginInstance.organizationId,
                  projectSlug: pluginInstance.projectSlug,
                  pluginInstanceId: pluginInstance.id,
                  email,
                  emailNormalized: normalizeEmailAddress(email),
                  name: nextName,
                  status: "pending",
                  mode: config.mode,
                  sourceHost: options.sourceHost,
                  sourcePath: refererParts.path,
                  referrerHost: refererParts.host,
                  utmSource: refererParts.utmSource,
                  utmMedium: refererParts.utmMedium,
                  utmCampaign: refererParts.utmCampaign,
                  lastIpHash: ipHash,
                  lastConfirmationSentAt: now,
                  lastSignupAt: now,
                  confirmedAt: null,
                  unsubscribedAt: null,
                })
                .returning()
            )[0];

      await sendConfirmationEmail({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        subscriberId: subscriber.id,
        email,
        redirectTarget,
        recipientName: subscriber.name ?? null,
        mode: config.mode,
      });

      return {
        redirectTarget,
        result: {
          email,
          status: "pending",
        },
      };
    }

    async confirmByToken(options: {
      token: string;
      redirect: string | null;
    }): Promise<NewsletterConfirmByTokenResult> {
      const tokenHash = hashToken(options.token);
      const rows = await db
        .select({
          tokenId: newsletterActionToken.id,
          subscriberId: newsletterSubscriber.id,
          organizationId: newsletterSubscriber.organizationId,
          projectSlug: newsletterSubscriber.projectSlug,
          status: newsletterSubscriber.status,
          pluginInstanceId: newsletterSubscriber.pluginInstanceId,
          configJson: projectPluginInstance.configJson,
          expiresAt: newsletterActionToken.expiresAt,
          usedAt: newsletterActionToken.usedAt,
        })
        .from(newsletterActionToken)
        .innerJoin(
          newsletterSubscriber,
          eq(newsletterActionToken.subscriberId, newsletterSubscriber.id),
        )
        .innerJoin(
          projectPluginInstance,
          eq(newsletterSubscriber.pluginInstanceId, projectPluginInstance.id),
        )
        .where(
          and(
            eq(newsletterActionToken.kind, "confirm"),
            eq(newsletterActionToken.tokenHash, tokenHash),
          ),
        );

      const row = rows[0];
      if (!row) return { status: "invalid" };
      if (
        row.expiresAt instanceof Date &&
        row.expiresAt.getTime() < Date.now()
      ) {
        return { status: "expired" };
      }
      const config = normalizeNewsletterConfig(row.configJson);
      const inferredSourceHosts = await inferSourceHosts({
        organizationId: row.organizationId,
        projectSlug: row.projectSlug,
      });
      const effectiveSourceHosts = resolveEffectiveSourceHosts(
        config,
        inferredSourceHosts,
        deps,
      );
      const effectiveRedirectHosts = resolveEffectiveRedirectHosts(
        config,
        effectiveSourceHosts,
        deps,
      );
      const redirectTarget = resolveRedirectTarget(
        options.redirect,
        effectiveRedirectHosts,
        deps,
      );

      if (row.status === "confirmed" || row.usedAt) {
        return {
          status: "already_confirmed",
          projectSlug: row.projectSlug,
          redirectTarget,
        };
      }

      await db
        .update(newsletterSubscriber)
        .set({
          status: "confirmed",
          confirmedAt: new Date(),
          unsubscribedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(newsletterSubscriber.id, row.subscriberId));

      await db
        .update(newsletterActionToken)
        .set({
          usedAt: new Date(),
        })
        .where(eq(newsletterActionToken.id, row.tokenId));

      return {
        status: "confirmed",
        projectSlug: row.projectSlug,
        redirectTarget,
      };
    }

    async unsubscribeByToken(options: {
      token: string;
      redirect: string | null;
    }): Promise<NewsletterUnsubscribeByTokenResult> {
      const tokenHash = hashToken(options.token);
      const rows = await db
        .select({
          subscriberId: newsletterSubscriber.id,
          organizationId: newsletterSubscriber.organizationId,
          projectSlug: newsletterSubscriber.projectSlug,
          status: newsletterSubscriber.status,
          configJson: projectPluginInstance.configJson,
          expiresAt: newsletterActionToken.expiresAt,
        })
        .from(newsletterActionToken)
        .innerJoin(
          newsletterSubscriber,
          eq(newsletterActionToken.subscriberId, newsletterSubscriber.id),
        )
        .innerJoin(
          projectPluginInstance,
          eq(newsletterSubscriber.pluginInstanceId, projectPluginInstance.id),
        )
        .where(
          and(
            eq(newsletterActionToken.kind, "unsubscribe"),
            eq(newsletterActionToken.tokenHash, tokenHash),
          ),
        );

      const row = rows[0];
      if (!row) return { status: "invalid" };
      if (
        row.expiresAt instanceof Date &&
        row.expiresAt.getTime() < Date.now()
      ) {
        return { status: "expired" };
      }

      const config = normalizeNewsletterConfig(row.configJson);
      const inferredSourceHosts = await inferSourceHosts({
        organizationId: row.organizationId,
        projectSlug: row.projectSlug,
      });
      const effectiveSourceHosts = resolveEffectiveSourceHosts(
        config,
        inferredSourceHosts,
        deps,
      );
      const effectiveRedirectHosts = resolveEffectiveRedirectHosts(
        config,
        effectiveSourceHosts,
        deps,
      );
      const redirectTarget = resolveRedirectTarget(
        options.redirect,
        effectiveRedirectHosts,
        deps,
      );

      if (row.status === "unsubscribed") {
        return {
          status: "already_unsubscribed",
          projectSlug: row.projectSlug,
          redirectTarget,
        };
      }

      await db
        .update(newsletterSubscriber)
        .set({
          status: "unsubscribed",
          unsubscribedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(newsletterSubscriber.id, row.subscriberId));

      return {
        status: "unsubscribed",
        projectSlug: row.projectSlug,
        redirectTarget,
      };
    }

    async resendConfirmation(options: {
      organizationId: string;
      projectSlug: string;
      email: string;
    }): Promise<NewsletterSubscriberMutationResult> {
      const subscriber = await findSubscriberByEmail(options);
      if (!subscriber) throw new NewsletterSubscriberNotFoundError(options.email);
      if (subscriber.status === "confirmed") {
        return { email: options.email, status: "already_confirmed" };
      }
      if (
        subscriber.status === "bounced" ||
        subscriber.status === "complained" ||
        subscriber.status === "unsubscribed"
      ) {
        throw new NewsletterSubscriberSuppressedError(options.email);
      }

      const now = new Date();
      if (
        subscriber.lastConfirmationSentAt instanceof Date &&
        now.getTime() - subscriber.lastConfirmationSentAt.getTime() < RESEND_COOLDOWN_MS
      ) {
        return { email: options.email, status: "pending_cooldown" };
      }

      await db
        .update(newsletterSubscriber)
        .set({
          lastConfirmationSentAt: now,
          updatedAt: now,
        })
        .where(eq(newsletterSubscriber.id, subscriber.id));

      await sendConfirmationEmail({
        organizationId: subscriber.organizationId,
        projectSlug: subscriber.projectSlug,
        subscriberId: subscriber.id,
        email: subscriber.email,
        redirectTarget: null,
        recipientName: subscriber.name ?? null,
        mode: subscriber.mode === "waitlist" ? "waitlist" : "newsletter",
      });

      return { email: options.email, status: "pending" };
    }

    async markConfirmed(options: {
      organizationId: string;
      projectSlug: string;
      email: string;
    }): Promise<NewsletterSubscriberMutationResult> {
      const subscriber = await findSubscriberByEmail(options);
      if (!subscriber) throw new NewsletterSubscriberNotFoundError(options.email);
      if (subscriber.status === "confirmed") {
        return { email: options.email, status: "already_confirmed" };
      }
      if (
        subscriber.status === "bounced" ||
        subscriber.status === "complained" ||
        subscriber.status === "unsubscribed"
      ) {
        throw new NewsletterSubscriberSuppressedError(options.email);
      }

      await db
        .update(newsletterSubscriber)
        .set({
          status: "confirmed",
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(newsletterSubscriber.id, subscriber.id));

      return { email: options.email, status: "confirmed" };
    }

    async unsubscribeSubscriber(options: {
      organizationId: string;
      projectSlug: string;
      email: string;
    }): Promise<NewsletterSubscriberMutationResult> {
      const subscriber = await findSubscriberByEmail(options);
      if (!subscriber) throw new NewsletterSubscriberNotFoundError(options.email);
      if (subscriber.status === "unsubscribed") {
        return { email: options.email, status: "already_unsubscribed" };
      }

      await db
        .update(newsletterSubscriber)
        .set({
          status: "unsubscribed",
          unsubscribedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(newsletterSubscriber.id, subscriber.id));

      return { email: options.email, status: "unsubscribed" };
    }

    async getNewsletterSummary(options: {
      organizationId: string;
      projectSlug: string;
      rangeDays: 7 | 30;
    }): Promise<NewsletterSummaryPayload> {
      const existing = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "newsletter",
      });
      if (!existing || existing.status !== "enabled") {
        return {
          pluginId: "newsletter",
          enabled: false,
          rangeDays: options.rangeDays,
          counts: {
            total: 0,
            pending: 0,
            confirmed: 0,
            unsubscribed: 0,
            bounced: 0,
            complained: 0,
          },
          recent: {
            signups: 0,
            confirmations: 0,
            unsubscribes: 0,
          },
        };
      }

      const counts = await getSubscriberCounts(options);
      const startedAt = new Date(Date.now() - options.rangeDays * 24 * 60 * 60 * 1000);
      const [recentSignupRows, recentConfirmRows, recentUnsubscribeRows] =
        await Promise.all([
          db
            .select({ count: sql<number>`count(*)` })
            .from(newsletterSubscriber)
            .where(
              and(
                eq(newsletterSubscriber.organizationId, options.organizationId),
                eq(newsletterSubscriber.projectSlug, options.projectSlug),
                gte(newsletterSubscriber.lastSignupAt, startedAt),
              ),
            ),
          db
            .select({ count: sql<number>`count(*)` })
            .from(newsletterSubscriber)
            .where(
              and(
                eq(newsletterSubscriber.organizationId, options.organizationId),
                eq(newsletterSubscriber.projectSlug, options.projectSlug),
                gte(newsletterSubscriber.confirmedAt, startedAt),
              ),
            ),
          db
            .select({ count: sql<number>`count(*)` })
            .from(newsletterSubscriber)
            .where(
              and(
                eq(newsletterSubscriber.organizationId, options.organizationId),
                eq(newsletterSubscriber.projectSlug, options.projectSlug),
                gte(newsletterSubscriber.unsubscribedAt, startedAt),
              ),
            ),
        ]);

      return {
        pluginId: "newsletter",
        enabled: true,
        rangeDays: options.rangeDays,
        counts,
        recent: {
          signups: toCount(recentSignupRows[0]?.count),
          confirmations: toCount(recentConfirmRows[0]?.count),
          unsubscribes: toCount(recentUnsubscribeRows[0]?.count),
        },
      };
    }

    async listSubscribers(options: {
      organizationId: string;
      projectSlug: string;
      status: "all" | "pending" | "confirmed" | "unsubscribed" | "bounced" | "complained";
      search?: string;
      limit?: number;
      offset?: number;
    }): Promise<NewsletterSubscribersPayload> {
      const existing = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "newsletter",
      });
      if (!existing || existing.status !== "enabled") {
        return {
          pluginId: "newsletter",
          enabled: false,
          status: options.status,
          search: options.search?.trim() || "",
          total: 0,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
          rows: [],
        };
      }

      const limit = Math.max(1, Math.min(200, options.limit ?? 50));
      const offset = Math.max(0, options.offset ?? 0);
      const search = options.search?.trim() || "";
      const searchPattern = search ? `%${search}%` : "";
      const where = and(
        eq(newsletterSubscriber.organizationId, options.organizationId),
        eq(newsletterSubscriber.projectSlug, options.projectSlug),
        options.status === "all"
          ? undefined
          : eq(newsletterSubscriber.status, options.status),
        search
          ? or(
              ilike(newsletterSubscriber.email, searchPattern),
              ilike(newsletterSubscriber.name, searchPattern),
            )
          : undefined,
      );

      const [countRows, rowResults] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(newsletterSubscriber)
          .where(where),
        db.query.newsletterSubscriber.findMany({
          where,
          limit,
          offset,
          orderBy: [desc(newsletterSubscriber.updatedAt), asc(newsletterSubscriber.email)],
        }),
      ]);

      return {
        pluginId: "newsletter",
        enabled: true,
        status: options.status,
        search,
        total: toCount(countRows[0]?.count),
        limit,
        offset,
        rows: rowResults.map((row: any) => ({
          id: row.id,
          email: row.email,
          name: row.name ?? null,
          status: row.status,
          sourceHost: row.sourceHost ?? null,
          sourcePath: row.sourcePath ?? null,
          utmSource: row.utmSource ?? null,
          utmMedium: row.utmMedium ?? null,
          utmCampaign: row.utmCampaign ?? null,
          lastSignupAt: toIsoString(row.lastSignupAt),
          lastConfirmationSentAt: toIsoString(row.lastConfirmationSentAt),
          confirmedAt: toIsoString(row.confirmedAt),
          unsubscribedAt: toIsoString(row.unsubscribedAt),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    }
  }

  return new NewsletterPluginServiceImpl();
}

export type NewsletterPluginService = ReturnType<
  typeof createNewsletterPluginService
>;
