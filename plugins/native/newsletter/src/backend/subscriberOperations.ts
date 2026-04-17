import { randomUUID } from "node:crypto";
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
import type {
  NewsletterConfirmByTokenResult,
  NewsletterPluginServiceDeps,
  NewsletterSubscribeInput,
  NewsletterSubscriberMutationResult,
  NewsletterUnsubscribeByTokenResult,
} from "./ports";
import {
  IP_RATE_LIMIT_PER_HOUR,
  RESEND_COOLDOWN_MS,
  TOKEN_RATE_LIMIT_PER_MINUTE,
  NewsletterPluginNotEnabledError,
  NewsletterSignupRateLimitError,
  NewsletterSignupSourceHostError,
  NewsletterSubscriberNotFoundError,
  NewsletterSubscriberSuppressedError,
  confirmEmailSchema,
  hashClientIp,
  hashToken,
  normalizeEmailAddress,
  normalizeName,
  normalizeNewsletterConfig,
  sendConfirmationEmail,
  toCount,
  toIsoString,
  type NewsletterStatus,
} from "./serviceShared";
import {
  parseRefererParts,
  resolveDefaultSuccessRedirectTarget,
  resolveEffectiveRedirectHosts,
  resolveEffectiveSourceHosts,
  resolveRedirectTarget,
} from "./sourceHosts";
import type {
  NewsletterSubscribersPayload,
  NewsletterSummaryPayload,
} from "../shared/summary";

export function createNewsletterSubscriberOperations(
  deps: NewsletterPluginServiceDeps,
) {
  const {
    db,
    tables,
    pluginEntitlementService,
    projectPluginInstanceService,
    inferSourceHosts,
    hostUtils,
  } = deps;
  const {
    newsletterSubscriber,
    newsletterActionToken,
    projectPluginInstance,
  } = tables;

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

  async function countRecentRequests(options: {
    pluginInstanceId: string;
    since: Date;
    ipHash: string | null;
  }) {
    const tokenRows = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(newsletterSubscriber)
      .where(
        and(
          eq(newsletterSubscriber.pluginInstanceId, options.pluginInstanceId),
          gte(newsletterSubscriber.updatedAt, options.since),
        ),
      );

    const ipRows = options.ipHash
      ? await db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(newsletterSubscriber)
          .where(
            and(
              eq(newsletterSubscriber.pluginInstanceId, options.pluginInstanceId),
              eq(newsletterSubscriber.lastIpHash, options.ipHash),
              gte(newsletterSubscriber.updatedAt, options.since),
            ),
          )
      : [];

    return {
      tokenCount: toCount(tokenRows[0]?.count),
      ipCount: toCount(ipRows[0]?.count),
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

  return {
    getSubscriberCounts,

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
      if (!hostUtils.isHostAllowed(options.sourceHost, effectiveSourceHosts)) {
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
          pluginInstanceId: pluginInstance.id,
          since: new Date(now.getTime() - 60_000),
          ipHash,
        }),
        countRecentRequests({
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
        now.getTime() - existing.lastConfirmationSentAt.getTime() <
          RESEND_COOLDOWN_MS
      ) {
        return {
          redirectTarget,
          result: {
            email,
            status: "pending_cooldown",
          },
        };
      }

      const nextName = config.collectName ? normalizeName(options.name) : null;
      const subscriber = existing
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
        deps,
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
    },

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
    },

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
    },

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
        now.getTime() - subscriber.lastConfirmationSentAt.getTime() <
          RESEND_COOLDOWN_MS
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
        deps,
        organizationId: subscriber.organizationId,
        projectSlug: subscriber.projectSlug,
        subscriberId: subscriber.id,
        email: subscriber.email,
        redirectTarget: null,
        recipientName: subscriber.name ?? null,
        mode: subscriber.mode === "waitlist" ? "waitlist" : "newsletter",
      });

      return { email: options.email, status: "pending" };
    },

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
    },

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
    },

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
      const startedAt = new Date(
        Date.now() - options.rangeDays * 24 * 60 * 60 * 1000,
      );
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
    },

    async listSubscribers(options: {
      organizationId: string;
      projectSlug: string;
      status:
        | "all"
        | "pending"
        | "confirmed"
        | "unsubscribed"
        | "bounced"
        | "complained";
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
    },
  };
}
