import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { NewsletterPluginServiceDeps } from "./ports";
import {
  NewsletterCampaignNotFoundError,
  NewsletterCampaignStateError,
  campaignBodySchema,
  campaignSubjectSchema,
  confirmEmailSchema,
  createEmptyDeliveryCounts,
  issueUnsubscribeToken,
  loadEnabledNewsletterPluginInstance,
  normalizeNewsletterConfig,
  readProjectTitle,
  resolvePublicEndpoints,
  sendCampaignEmail,
  toCount,
  toIsoString,
  type NewsletterCampaignDeliveryStatus,
  type NewsletterCampaignStatus,
  type NewsletterProjectScope,
} from "./serviceShared";
import type {
  NewsletterCampaignAudience,
  NewsletterCampaignsPayload,
} from "../shared/summary";

export function createNewsletterCampaignOperations(
  deps: NewsletterPluginServiceDeps,
) {
  const { db, tables } = deps;
  const {
    newsletterCampaign,
    newsletterCampaignDelivery,
    newsletterSubscriber,
  } = tables;

  async function loadCampaignById(options: NewsletterProjectScope & {
    campaignId: string;
  }) {
    return db.query.newsletterCampaign.findFirst({
      where: and(
        eq(newsletterCampaign.id, options.campaignId),
        eq(newsletterCampaign.organizationId, options.organizationId),
        eq(newsletterCampaign.projectSlug, options.projectSlug),
      ),
    });
  }

  async function countConfirmedAudience(options: NewsletterProjectScope & {
    mode: "newsletter" | "waitlist";
    audience: NewsletterCampaignAudience;
  }) {
    const countRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(newsletterSubscriber)
      .where(
        and(
          eq(newsletterSubscriber.organizationId, options.organizationId),
          eq(newsletterSubscriber.projectSlug, options.projectSlug),
          eq(newsletterSubscriber.status, "confirmed"),
          options.audience === "mode_confirmed"
            ? eq(newsletterSubscriber.mode, options.mode)
            : undefined,
        ),
      );

    return toCount(countRows[0]?.count);
  }

  async function listAudienceSubscribers(options: NewsletterProjectScope & {
    mode: "newsletter" | "waitlist";
    audience: NewsletterCampaignAudience;
  }) {
    return db.query.newsletterSubscriber.findMany({
      where: and(
        eq(newsletterSubscriber.organizationId, options.organizationId),
        eq(newsletterSubscriber.projectSlug, options.projectSlug),
        eq(newsletterSubscriber.status, "confirmed"),
        options.audience === "mode_confirmed"
          ? eq(newsletterSubscriber.mode, options.mode)
          : undefined,
      ),
      orderBy: [asc(newsletterSubscriber.email)],
    });
  }

  async function loadSubscriberById(subscriberId: string) {
    return db.query.newsletterSubscriber.findFirst({
      where: eq(newsletterSubscriber.id, subscriberId),
    });
  }

  async function buildCampaignDeliveryCountMap(campaignIds: string[]) {
    const countsByCampaignId = new Map<
      string,
      Record<NewsletterCampaignDeliveryStatus, number>
    >();
    if (campaignIds.length === 0) return countsByCampaignId;

    const rows = await db
      .select({
        campaignId: newsletterCampaignDelivery.campaignId,
        status: newsletterCampaignDelivery.status,
        count: sql<number>`count(*)`,
      })
      .from(newsletterCampaignDelivery)
      .where(inArray(newsletterCampaignDelivery.campaignId, campaignIds))
      .groupBy(
        newsletterCampaignDelivery.campaignId,
        newsletterCampaignDelivery.status,
      );

    for (const campaignId of campaignIds) {
      countsByCampaignId.set(campaignId, createEmptyDeliveryCounts());
    }

    for (const row of rows as Array<{
      campaignId: string;
      status: NewsletterCampaignDeliveryStatus;
      count: number;
    }>) {
      const counts =
        countsByCampaignId.get(row.campaignId) ?? createEmptyDeliveryCounts();
      if (
        row.status === "queued" ||
        row.status === "sending" ||
        row.status === "sent" ||
        row.status === "failed" ||
        row.status === "skipped" ||
        row.status === "canceled"
      ) {
        counts[row.status] = toCount(row.count);
      }
      countsByCampaignId.set(row.campaignId, counts);
    }

    return countsByCampaignId;
  }

  async function refreshCampaignState(campaignId: string) {
    const campaign = await db.query.newsletterCampaign.findFirst({
      where: eq(newsletterCampaign.id, campaignId),
    });
    if (!campaign) return null;

    const countsMap = await buildCampaignDeliveryCountMap([campaignId]);
    const counts = countsMap.get(campaignId) ?? createEmptyDeliveryCounts();
    const now = new Date();

    if (campaign.status === "canceled") {
      await db
        .update(newsletterCampaign)
        .set({
          updatedAt: now,
          completedAt:
            counts.queued === 0 && counts.sending === 0
              ? (campaign.completedAt ?? now)
              : campaign.completedAt,
        })
        .where(eq(newsletterCampaign.id, campaignId));
      return { ...campaign, status: "canceled" as const, counts };
    }

    if (counts.queued > 0 || counts.sending > 0) {
      await db
        .update(newsletterCampaign)
        .set({
          status: "sending",
          startedAt: campaign.startedAt ?? now,
          updatedAt: now,
        })
        .where(eq(newsletterCampaign.id, campaignId));
      return { ...campaign, status: "sending" as const, counts };
    }

    const finalStatus = counts.failed > 0 ? "failed" : "sent";
    await db
      .update(newsletterCampaign)
      .set({
        status: finalStatus,
        completedAt: campaign.completedAt ?? now,
        updatedAt: now,
      })
      .where(eq(newsletterCampaign.id, campaignId));

    return { ...campaign, status: finalStatus, counts };
  }

  return {
    async listCampaigns(options: {
      organizationId: string;
      projectSlug: string;
      status:
        | "all"
        | "draft"
        | "queued"
        | "sending"
        | "sent"
        | "failed"
        | "canceled";
      limit?: number;
      offset?: number;
    }): Promise<NewsletterCampaignsPayload> {
      const existing = await deps.projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "newsletter",
      });
      if (!existing || existing.status !== "enabled") {
        return {
          pluginId: "newsletter",
          enabled: false,
          status: options.status,
          total: 0,
          limit: options.limit ?? 20,
          offset: options.offset ?? 0,
          currentMode: "newsletter",
          audienceOptions: {
            allConfirmed: 0,
            modeConfirmed: 0,
          },
          rows: [],
        };
      }

      const config = normalizeNewsletterConfig(existing.configJson);
      const limit = Math.max(1, Math.min(100, options.limit ?? 20));
      const offset = Math.max(0, options.offset ?? 0);
      const where = and(
        eq(newsletterCampaign.organizationId, options.organizationId),
        eq(newsletterCampaign.projectSlug, options.projectSlug),
        options.status === "all"
          ? undefined
          : eq(newsletterCampaign.status, options.status),
      );

      const [countRows, rowResults, allConfirmed, modeConfirmed] =
        await Promise.all([
          db
            .select({ count: sql<number>`count(*)` })
            .from(newsletterCampaign)
            .where(where),
          db.query.newsletterCampaign.findMany({
            where,
            limit,
            offset,
            orderBy: [desc(newsletterCampaign.updatedAt), asc(newsletterCampaign.subject)],
          }),
          countConfirmedAudience({
            organizationId: options.organizationId,
            projectSlug: options.projectSlug,
            mode: config.mode,
            audience: "all_confirmed",
          }),
          countConfirmedAudience({
            organizationId: options.organizationId,
            projectSlug: options.projectSlug,
            mode: config.mode,
            audience: "mode_confirmed",
          }),
        ]);
      const deliveryCountsByCampaignId = await buildCampaignDeliveryCountMap(
        rowResults.map((row: any) => row.id),
      );

      return {
        pluginId: "newsletter",
        enabled: true,
        status: options.status,
        total: toCount(countRows[0]?.count),
        limit,
        offset,
        currentMode: config.mode,
        audienceOptions: {
          allConfirmed,
          modeConfirmed,
        },
        rows: rowResults.map((row: any) => {
          const deliveryCounts =
            deliveryCountsByCampaignId.get(row.id) ?? createEmptyDeliveryCounts();
          return {
            id: row.id,
            subject: row.subject,
            body: row.body,
            status:
              (row.status as NewsletterCampaignStatus) === "draft" ||
              row.status === "queued" ||
              row.status === "sending" ||
              row.status === "sent" ||
              row.status === "failed" ||
              row.status === "canceled"
                ? row.status
                : "draft",
            audience:
              row.audience === "mode_confirmed"
                ? "mode_confirmed"
                : "all_confirmed",
            mode: row.mode === "waitlist" ? "waitlist" : "newsletter",
            estimatedRecipientCount: toCount(row.estimatedRecipientCount),
            recipientCount: toCount(row.recipientCount),
            deliveryCounts,
            testSentAt: toIsoString(row.testSentAt),
            queuedAt: toIsoString(row.queuedAt),
            startedAt: toIsoString(row.startedAt),
            completedAt: toIsoString(row.completedAt),
            canceledAt: toIsoString(row.canceledAt),
            lastError: row.lastError ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          };
        }),
      };
    },

    async saveCampaignDraft(options: {
      organizationId: string;
      projectSlug: string;
      campaignId?: string | null;
      subject: string;
      body: string;
      audience: NewsletterCampaignAudience;
    }): Promise<{
      campaignId: string;
      status: "draft";
      estimatedRecipientCount: number;
    }> {
      const existing = await loadEnabledNewsletterPluginInstance(deps, options);
      const config = normalizeNewsletterConfig(existing.configJson);
      const subject = campaignSubjectSchema.parse(options.subject);
      const body = campaignBodySchema.parse(options.body);
      const audience =
        options.audience === "mode_confirmed"
          ? "mode_confirmed"
          : "all_confirmed";
      const estimatedRecipientCount = await countConfirmedAudience({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        mode: config.mode,
        audience,
      });

      if (options.campaignId) {
        const campaign = await loadCampaignById({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          campaignId: options.campaignId,
        });
        if (!campaign) {
          throw new NewsletterCampaignNotFoundError(options.campaignId);
        }
        if (campaign.status !== "draft") {
          throw new NewsletterCampaignStateError(
            "Only draft campaigns can be edited right now.",
          );
        }

        const [updated] = await db
          .update(newsletterCampaign)
          .set({
            mode: config.mode,
            audience,
            subject,
            body,
            estimatedRecipientCount,
            updatedAt: new Date(),
          })
          .where(eq(newsletterCampaign.id, options.campaignId))
          .returning();

        return {
          campaignId: updated?.id ?? options.campaignId,
          status: "draft",
          estimatedRecipientCount,
        };
      }

      const campaignId = randomUUID();
      const [created] = await db
        .insert(newsletterCampaign)
        .values({
          id: campaignId,
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginInstanceId: existing.id,
          mode: config.mode,
          status: "draft",
          audience,
          subject,
          body,
          estimatedRecipientCount,
        })
        .returning();

      return {
        campaignId: created?.id ?? campaignId,
        status: "draft",
        estimatedRecipientCount,
      };
    },

    async deleteCampaignDraft(options: {
      organizationId: string;
      projectSlug: string;
      campaignId: string;
    }): Promise<{
      campaignId: string;
      status: "deleted";
    }> {
      await loadEnabledNewsletterPluginInstance(deps, options);

      const campaign = await loadCampaignById(options);
      if (!campaign) {
        throw new NewsletterCampaignNotFoundError(options.campaignId);
      }
      if (campaign.status !== "draft") {
        throw new NewsletterCampaignStateError(
          "Only draft campaigns can be deleted right now.",
        );
      }

      await db
        .delete(newsletterCampaign)
        .where(eq(newsletterCampaign.id, options.campaignId));

      return {
        campaignId: options.campaignId,
        status: "deleted",
      };
    },

    async testSendCampaign(options: {
      organizationId: string;
      projectSlug: string;
      campaignId: string;
      email: string;
    }): Promise<{
      campaignId: string;
      status: "test_sent";
      email: string;
    }> {
      await loadEnabledNewsletterPluginInstance(deps, options);

      const campaign = await loadCampaignById(options);
      if (!campaign) {
        throw new NewsletterCampaignNotFoundError(options.campaignId);
      }
      const recipientEmail = confirmEmailSchema.parse(options.email);
      const projectTitle = await readProjectTitle(deps, options);

      await sendCampaignEmail({
        deps,
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        projectTitle,
        campaignId: campaign.id,
        subject: campaign.subject,
        body: campaign.body,
        email: recipientEmail,
        mode: campaign.mode === "waitlist" ? "waitlist" : "newsletter",
        isTest: true,
      });

      await db
        .update(newsletterCampaign)
        .set({
          testSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(newsletterCampaign.id, options.campaignId));

      return {
        campaignId: campaign.id,
        status: "test_sent",
        email: recipientEmail,
      };
    },

    async sendCampaign(options: {
      organizationId: string;
      projectSlug: string;
      campaignId: string;
    }): Promise<{
      campaignId: string;
      status: "queued";
      recipientCount: number;
    }> {
      const existing = await loadEnabledNewsletterPluginInstance(deps, options);

      const campaign = await loadCampaignById(options);
      if (!campaign) {
        throw new NewsletterCampaignNotFoundError(options.campaignId);
      }
      if (campaign.status !== "draft") {
        throw new NewsletterCampaignStateError(
          "Only draft campaigns can be queued right now.",
        );
      }

      const subscribers = await listAudienceSubscribers({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        mode: campaign.mode === "waitlist" ? "waitlist" : "newsletter",
        audience:
          campaign.audience === "mode_confirmed"
            ? "mode_confirmed"
            : "all_confirmed",
      });

      if (subscribers.length === 0) {
        throw new NewsletterCampaignStateError(
          "No confirmed subscribers currently match this campaign audience.",
        );
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        const [queuedCampaign] = await tx
          .update(newsletterCampaign)
          .set({
            status: "queued",
            recipientCount: subscribers.length,
            queuedAt: now,
            startedAt: null,
            completedAt: null,
            canceledAt: null,
            lastError: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(newsletterCampaign.id, options.campaignId),
              eq(newsletterCampaign.status, "draft"),
            ),
          )
          .returning();

        if (!queuedCampaign) {
          throw new NewsletterCampaignStateError(
            "Only draft campaigns can be queued right now.",
          );
        }

        await tx
          .delete(newsletterCampaignDelivery)
          .where(eq(newsletterCampaignDelivery.campaignId, options.campaignId));

        await tx.insert(newsletterCampaignDelivery).values(
          subscribers.map((subscriber: any) => ({
            id: randomUUID(),
            campaignId: options.campaignId,
            subscriberId: subscriber.id,
            organizationId: options.organizationId,
            projectSlug: options.projectSlug,
            pluginInstanceId: existing.id,
            email: subscriber.email,
            emailNormalized: subscriber.emailNormalized,
            recipientName: subscriber.name ?? null,
            status: "queued",
          })),
        );
      });

      return {
        campaignId: options.campaignId,
        status: "queued",
        recipientCount: subscribers.length,
      };
    },

    async cancelCampaign(options: {
      organizationId: string;
      projectSlug: string;
      campaignId: string;
    }): Promise<{
      campaignId: string;
      status: "canceled";
    }> {
      await loadEnabledNewsletterPluginInstance(deps, options);

      const campaign = await loadCampaignById(options);
      if (!campaign) {
        throw new NewsletterCampaignNotFoundError(options.campaignId);
      }
      if (campaign.status !== "queued" && campaign.status !== "sending") {
        throw new NewsletterCampaignStateError(
          "Only queued or sending campaigns can be canceled right now.",
        );
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        const [updatedCampaign] = await tx
          .update(newsletterCampaign)
          .set({
            status: "canceled",
            canceledAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(newsletterCampaign.id, options.campaignId),
              or(
                eq(newsletterCampaign.status, "queued"),
                eq(newsletterCampaign.status, "sending"),
              ),
            ),
          )
          .returning();

        if (!updatedCampaign) {
          throw new NewsletterCampaignStateError(
            "Only queued or sending campaigns can be canceled right now.",
          );
        }

        await tx
          .update(newsletterCampaignDelivery)
          .set({
            status: "canceled",
            updatedAt: now,
          })
          .where(
            and(
              eq(newsletterCampaignDelivery.campaignId, options.campaignId),
              eq(newsletterCampaignDelivery.status, "queued"),
            ),
          );
      });

      await refreshCampaignState(options.campaignId);

      return {
        campaignId: options.campaignId,
        status: "canceled",
      };
    },

    async processQueuedCampaigns(): Promise<number> {
      const nextCampaign = await db.query.newsletterCampaign.findFirst({
        where: or(
          eq(newsletterCampaign.status, "queued"),
          eq(newsletterCampaign.status, "sending"),
        ),
        orderBy: [asc(newsletterCampaign.queuedAt), asc(newsletterCampaign.updatedAt)],
      });

      if (!nextCampaign) return 0;

      const now = new Date();
      const activeCampaign =
        nextCampaign.status === "queued"
          ? (
              await db
                .update(newsletterCampaign)
                .set({
                  status: "sending",
                  startedAt: nextCampaign.startedAt ?? now,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(newsletterCampaign.id, nextCampaign.id),
                    eq(newsletterCampaign.status, "queued"),
                  ),
                )
                .returning()
            )[0] ?? null
          : nextCampaign;

      if (!activeCampaign) return 0;

      const queuedDeliveries = await db.query.newsletterCampaignDelivery.findMany({
        where: and(
          eq(newsletterCampaignDelivery.campaignId, activeCampaign.id),
          eq(newsletterCampaignDelivery.status, "queued"),
        ),
        limit: 25,
        orderBy: [asc(newsletterCampaignDelivery.createdAt)],
      });

      if (queuedDeliveries.length === 0) {
        await refreshCampaignState(activeCampaign.id);
        return 0;
      }

      const [projectTitle, endpoints] = await Promise.all([
        readProjectTitle(deps, {
          organizationId: activeCampaign.organizationId,
          projectSlug: activeCampaign.projectSlug,
        }),
        resolvePublicEndpoints(deps),
      ]);

      let processedCount = 0;

      for (const delivery of queuedDeliveries as any[]) {
        const latestCampaign = await loadCampaignById({
          organizationId: activeCampaign.organizationId,
          projectSlug: activeCampaign.projectSlug,
          campaignId: activeCampaign.id,
        });
        if (!latestCampaign || latestCampaign.status === "canceled") {
          break;
        }

        const claimedDelivery = (
          await db
            .update(newsletterCampaignDelivery)
            .set({
              status: "sending",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(newsletterCampaignDelivery.id, delivery.id),
                eq(newsletterCampaignDelivery.status, "queued"),
              ),
            )
            .returning()
        )[0];

        if (!claimedDelivery) {
          continue;
        }

        processedCount += 1;

        try {
          const subscriber = await loadSubscriberById(claimedDelivery.subscriberId);
          const modeMatches =
            latestCampaign.audience !== "mode_confirmed" ||
            subscriber?.mode === latestCampaign.mode;
          if (!subscriber || subscriber.status !== "confirmed" || !modeMatches) {
            await db
              .update(newsletterCampaignDelivery)
              .set({
                status: "skipped",
                skipReason: !subscriber
                  ? "Subscriber record no longer exists."
                  : subscriber.status !== "confirmed"
                    ? "Subscriber is no longer confirmed."
                    : "Subscriber no longer matches the campaign mode filter.",
                updatedAt: new Date(),
              })
              .where(eq(newsletterCampaignDelivery.id, claimedDelivery.id));
            continue;
          }

          const unsubscribeToken = await issueUnsubscribeToken({
            deps,
            subscriberId: subscriber.id,
            organizationId: latestCampaign.organizationId,
            projectSlug: latestCampaign.projectSlug,
          });
          const unsubscribeUrl = `${endpoints.unsubscribeEndpoint}?token=${encodeURIComponent(
            unsubscribeToken,
          )}`;
          const deliveryResult = await sendCampaignEmail({
            deps,
            organizationId: latestCampaign.organizationId,
            projectSlug: latestCampaign.projectSlug,
            projectTitle,
            campaignId: latestCampaign.id,
            subject: latestCampaign.subject,
            body: latestCampaign.body,
            email: claimedDelivery.email,
            recipientName: claimedDelivery.recipientName ?? null,
            unsubscribeUrl,
            mode: latestCampaign.mode === "waitlist" ? "waitlist" : "newsletter",
          });

          await db
            .update(newsletterCampaignDelivery)
            .set({
              status: "sent",
              provider: deliveryResult.provider,
              providerMessageId: deliveryResult.messageId ?? null,
              sentAt: new Date(),
              skipReason: null,
              failureReason: null,
              updatedAt: new Date(),
            })
            .where(eq(newsletterCampaignDelivery.id, claimedDelivery.id));
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to send campaign email.";
          await db
            .update(newsletterCampaignDelivery)
            .set({
              status: "failed",
              failureReason: message,
              updatedAt: new Date(),
            })
            .where(eq(newsletterCampaignDelivery.id, claimedDelivery.id));
          await db
            .update(newsletterCampaign)
            .set({
              lastError: message,
              updatedAt: new Date(),
            })
            .where(eq(newsletterCampaign.id, latestCampaign.id));
        }
      }

      await refreshCampaignState(activeCampaign.id);

      return processedCount;
    },
  };
}
