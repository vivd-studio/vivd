import { describe, expect, it, vi } from "vitest";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createNewsletterPluginService } from "@vivd/plugin-newsletter/backend/service";

const newsletterSubscriberTable = pgTable("newsletter_subscriber_sending_test", {
  id: text("id"),
  organizationId: text("organization_id"),
  projectSlug: text("project_slug"),
  pluginInstanceId: text("plugin_instance_id"),
  email: text("email"),
  emailNormalized: text("email_normalized"),
  name: text("name"),
  status: text("status"),
  mode: text("mode"),
  updatedAt: timestamp("updated_at"),
});

const newsletterActionTokenTable = pgTable("newsletter_action_token_sending_test", {
  id: text("id"),
  subscriberId: text("subscriber_id"),
  organizationId: text("organization_id"),
  projectSlug: text("project_slug"),
  kind: text("kind"),
  tokenHash: text("token_hash"),
  expiresAt: timestamp("expires_at"),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at"),
});

const newsletterCampaignTable = pgTable("newsletter_campaign_sending_test", {
  id: text("id"),
  organizationId: text("organization_id"),
  projectSlug: text("project_slug"),
  pluginInstanceId: text("plugin_instance_id"),
  mode: text("mode"),
  status: text("status"),
  audience: text("audience"),
  subject: text("subject"),
  body: text("body"),
  estimatedRecipientCount: integer("estimated_recipient_count"),
  recipientCount: integer("recipient_count"),
  testSentAt: timestamp("test_sent_at"),
  queuedAt: timestamp("queued_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  canceledAt: timestamp("canceled_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

const newsletterCampaignDeliveryTable = pgTable("newsletter_campaign_delivery_sending_test", {
  id: text("id"),
  campaignId: text("campaign_id"),
  subscriberId: text("subscriber_id"),
  organizationId: text("organization_id"),
  projectSlug: text("project_slug"),
  pluginInstanceId: text("plugin_instance_id"),
  email: text("email"),
  emailNormalized: text("email_normalized"),
  recipientName: text("recipient_name"),
  status: text("status"),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  skipReason: text("skip_reason"),
  failureReason: text("failure_reason"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

const projectMetaTable = pgTable("project_meta_sending_test", {
  organizationId: text("organization_id"),
  slug: text("slug"),
  title: text("title"),
});

const projectPluginInstanceTable = pgTable("project_plugin_instance_sending_test", {
  id: text("id"),
  pluginId: text("plugin_id"),
  publicToken: text("public_token"),
  status: text("status"),
});

type StoredSubscriberRow = {
  id: string;
  organizationId: string;
  projectSlug: string;
  pluginInstanceId: string;
  email: string;
  emailNormalized: string;
  name: string | null;
  status: string;
  mode: "newsletter" | "waitlist";
  updatedAt: Date;
};

type StoredCampaignRow = {
  id: string;
  organizationId: string;
  projectSlug: string;
  pluginInstanceId: string;
  mode: "newsletter" | "waitlist";
  status: "draft" | "queued" | "sending" | "sent" | "failed" | "canceled";
  audience: "all_confirmed" | "mode_confirmed";
  subject: string;
  body: string;
  estimatedRecipientCount: number;
  recipientCount: number;
  testSentAt: Date | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type StoredDeliveryRow = {
  id: string;
  campaignId: string;
  subscriberId: string;
  organizationId: string;
  projectSlug: string;
  pluginInstanceId: string;
  email: string;
  emailNormalized: string;
  recipientName: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "skipped" | "canceled";
  provider: string | null;
  providerMessageId: string | null;
  skipReason: string | null;
  failureReason: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRowKey(columnName: string): string {
  return columnName.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function collectEqFilters(
  node: unknown,
  filters: Record<string, unknown[]> = {},
): Record<string, unknown[]> {
  if (!node || typeof node !== "object") return filters;
  const chunks = Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)
    ? (node as { queryChunks: unknown[] }).queryChunks
    : [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] as
      | { name?: string; value?: unknown[]; queryChunks?: unknown[] }
      | undefined;
    const nextChunk = chunks[index + 1] as { value?: unknown[] } | undefined;
    const paramChunk = chunks[index + 2] as { value?: unknown } | undefined;

    if (chunk?.name && nextChunk?.value?.[0] === " = ") {
      const key = toRowKey(chunk.name);
      const value =
        paramChunk && Object.prototype.hasOwnProperty.call(paramChunk, "value")
          ? paramChunk.value
          : paramChunk;
      filters[key] = [...(filters[key] ?? []), value];
    }

    collectEqFilters(chunk, filters);
  }

  return filters;
}

function matchesWhere<T extends Record<string, unknown>>(row: T, where: unknown): boolean {
  const filters = collectEqFilters(where);
  return Object.entries(filters).every(([key, values]) => values.includes(row[key]));
}

function sortCampaignRows(rows: StoredCampaignRow[]): StoredCampaignRow[] {
  return [...rows].sort((left, right) => {
    const leftTime = left.queuedAt?.getTime() ?? left.updatedAt.getTime();
    const rightTime = right.queuedAt?.getTime() ?? right.updatedAt.getTime();
    return leftTime - rightTime;
  });
}

function createHarness(options?: {
  campaigns?: Partial<StoredCampaignRow>[];
  subscribers?: Partial<StoredSubscriberRow>[];
  deliveries?: Partial<StoredDeliveryRow>[];
}) {
  const now = new Date("2026-04-17T12:00:00.000Z");
  const pluginInstance = {
    id: "plugin-1",
    organizationId: "org-1",
    projectSlug: "site-1",
    status: "enabled",
    configJson: {
      mode: "newsletter",
      collectName: false,
      sourceHosts: [],
      redirectHostAllowlist: [],
    },
    publicToken: "public-token",
    createdAt: now,
    updatedAt: now,
  };

  const storedSubscribers: StoredSubscriberRow[] = (
    options?.subscribers ?? [
      {
        id: "sub-1",
        email: "alpha@example.com",
        emailNormalized: "alpha@example.com",
        status: "confirmed",
        mode: "newsletter",
        name: "Alpha",
      },
      {
        id: "sub-2",
        email: "beta@example.com",
        emailNormalized: "beta@example.com",
        status: "confirmed",
        mode: "newsletter",
        name: "Beta",
      },
      {
        id: "sub-3",
        email: "gamma@example.com",
        emailNormalized: "gamma@example.com",
        status: "confirmed",
        mode: "waitlist",
        name: "Gamma",
      },
    ]
  ).map((row, index) => ({
    id: row.id ?? `sub-${index + 1}`,
    organizationId: "org-1",
    projectSlug: "site-1",
    pluginInstanceId: "plugin-1",
    email: row.email ?? `user${index + 1}@example.com`,
    emailNormalized:
      row.emailNormalized ?? (row.email ?? `user${index + 1}@example.com`).toLowerCase(),
    name: row.name ?? null,
    status: row.status ?? "confirmed",
    mode: row.mode ?? "newsletter",
    updatedAt: row.updatedAt ?? now,
    ...row,
  }));

  const storedCampaigns: StoredCampaignRow[] = (options?.campaigns ?? []).map((row, index) => ({
    id: row.id ?? `campaign-${index + 1}`,
    organizationId: "org-1",
    projectSlug: "site-1",
    pluginInstanceId: "plugin-1",
    mode: row.mode ?? "newsletter",
    status: row.status ?? "draft",
    audience: row.audience ?? "all_confirmed",
    subject: row.subject ?? `Campaign ${index + 1}`,
    body: row.body ?? `Body ${index + 1}`,
    estimatedRecipientCount: row.estimatedRecipientCount ?? 0,
    recipientCount: row.recipientCount ?? 0,
    testSentAt: row.testSentAt ?? null,
    queuedAt: row.queuedAt ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    canceledAt: row.canceledAt ?? null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt ?? now,
    updatedAt: row.updatedAt ?? now,
    ...row,
  }));

  const storedDeliveries: StoredDeliveryRow[] = (options?.deliveries ?? []).map(
    (row, index) => ({
      id: row.id ?? `delivery-${index + 1}`,
      campaignId: row.campaignId ?? "campaign-1",
      subscriberId: row.subscriberId ?? "sub-1",
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginInstanceId: "plugin-1",
      email: row.email ?? `delivery${index + 1}@example.com`,
      emailNormalized:
        row.emailNormalized ??
        (row.email ?? `delivery${index + 1}@example.com`).toLowerCase(),
      recipientName: row.recipientName ?? null,
      status: row.status ?? "queued",
      provider: row.provider ?? null,
      providerMessageId: row.providerMessageId ?? null,
      skipReason: row.skipReason ?? null,
      failureReason: row.failureReason ?? null,
      sentAt: row.sentAt ?? null,
      createdAt: row.createdAt ?? now,
      updatedAt: row.updatedAt ?? now,
      ...row,
    }),
  );

  const storedActionTokens: Array<Record<string, unknown>> = [];

  function makeUpdateChain<T extends Record<string, unknown>>(
    rows: T[],
    updates: Record<string, unknown>,
  ) {
    return {
      where(where: unknown) {
        const matched = rows
          .filter((row) => matchesWhere(row, where))
          .map((row) => {
            Object.assign(row, updates);
            return { ...row };
          });
        return {
          returning: async () => matched,
        };
      },
    };
  }

  function makeInsertChain<T extends Record<string, unknown>>(rows: T[], defaults?: () => object) {
    return {
      values(values: any) {
        const entries = Array.isArray(values) ? values : [values];
        const inserted = entries.map((entry) => {
          const row = {
            ...(defaults ? defaults() : {}),
            ...entry,
          } as T;
          rows.push(row);
          return row;
        });
        return {
          returning: async () => inserted.map((row) => ({ ...row })),
        };
      },
    };
  }

  const db = {
    query: {
      newsletterCampaign: {
        findFirst: vi.fn(
          async ({ where }: { where?: unknown }) =>
            sortCampaignRows(storedCampaigns.filter((row) => matchesWhere(row, where)))[0] ??
            null,
        ),
        findMany: vi.fn(
          async ({
            where,
            limit,
            offset,
          }: {
            where?: unknown;
            limit?: number;
            offset?: number;
          }) =>
            sortCampaignRows(
              storedCampaigns.filter((row) => matchesWhere(row, where)),
            ).slice(offset ?? 0, (offset ?? 0) + (limit ?? storedCampaigns.length)),
        ),
      },
      newsletterCampaignDelivery: {
        findMany: vi.fn(
          async ({
            where,
            limit,
          }: {
            where?: unknown;
            limit?: number;
          }) =>
            storedDeliveries
              .filter((row) => matchesWhere(row, where))
              .slice(0, limit ?? storedDeliveries.length),
        ),
      },
      newsletterSubscriber: {
        findFirst: vi.fn(async ({ where }: { where?: unknown }) => {
          const rows = storedSubscribers.filter((row) => matchesWhere(row, where));
          return rows[0] ?? null;
        }),
        findMany: vi.fn(async ({ where }: { where?: unknown }) =>
          storedSubscribers.filter((row) => matchesWhere(row, where)),
        ),
      },
      projectMeta: {
        findFirst: vi.fn(async () => ({ title: "Site 1" })),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn((table) => ({
        where: vi.fn((where?: unknown) => ({
          groupBy: vi.fn(async () => {
            if (table !== newsletterCampaignDeliveryTable) return [];
            const grouped = new Map<string, { campaignId: string; status: string; count: number }>();
            for (const row of storedDeliveries.filter((entry) => matchesWhere(entry, where))) {
              const key = `${row.campaignId}:${row.status}`;
              const existing = grouped.get(key);
              if (existing) {
                existing.count += 1;
              } else {
                grouped.set(key, {
                  campaignId: row.campaignId,
                  status: row.status,
                  count: 1,
                });
              }
            }
            return [...grouped.values()];
          }),
          then(onFulfilled: (value: unknown) => unknown) {
            if (table === newsletterCampaignTable) {
              return Promise.resolve([
                {
                  count: storedCampaigns.filter((row) => matchesWhere(row, where)).length,
                },
              ]).then(onFulfilled);
            }
            if (table === newsletterSubscriberTable) {
              return Promise.resolve([
                {
                  count: storedSubscribers.filter((row) => matchesWhere(row, where)).length,
                },
              ]).then(onFulfilled);
            }
            return Promise.resolve([]).then(onFulfilled);
          },
        })),
      })),
    })),
    insert: vi.fn((table) => {
      if (table === newsletterCampaignTable) {
        return makeInsertChain(storedCampaigns);
      }
      if (table === newsletterCampaignDeliveryTable) {
        return makeInsertChain(storedDeliveries, () => ({
          provider: null,
          providerMessageId: null,
          skipReason: null,
          failureReason: null,
          sentAt: null,
          createdAt: now,
          updatedAt: now,
        }));
      }
      return makeInsertChain(storedActionTokens);
    }),
    update: vi.fn((table) => {
      if (table === newsletterCampaignTable) {
        return {
          set: vi.fn((updates) => makeUpdateChain(storedCampaigns, updates)),
        };
      }
      if (table === newsletterCampaignDeliveryTable) {
        return {
          set: vi.fn((updates) => makeUpdateChain(storedDeliveries, updates)),
        };
      }
      if (table === newsletterSubscriberTable) {
        return {
          set: vi.fn((updates) => makeUpdateChain(storedSubscribers, updates)),
        };
      }
      return {
        set: vi.fn((updates) => makeUpdateChain(storedActionTokens, updates)),
      };
    }),
    delete: vi.fn((table) => ({
      where: vi.fn((where) => {
        const rows =
          table === newsletterCampaignDeliveryTable
            ? storedDeliveries
            : table === newsletterActionTokenTable
              ? storedActionTokens
              : storedCampaigns;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (matchesWhere(rows[index] as Record<string, unknown>, where)) {
            rows.splice(index, 1);
          }
        }
      }),
    })),
    transaction: vi.fn(async (callback) => callback(db)),
  };

  const sendEmailMock = vi.fn().mockResolvedValue({
    accepted: true,
    provider: "noop",
    messageId: "message-1",
  });

  const service = createNewsletterPluginService({
    db: db as any,
    tables: {
      newsletterSubscriber: newsletterSubscriberTable,
      newsletterActionToken: newsletterActionTokenTable,
      newsletterCampaign: newsletterCampaignTable,
      newsletterCampaignDelivery: newsletterCampaignDeliveryTable,
      projectMeta: projectMetaTable,
      projectPluginInstance: projectPluginInstanceTable,
    } as any,
    pluginEntitlementService: {
      resolveEffectiveEntitlement: vi.fn(),
    },
    projectPluginInstanceService: {
      ensurePluginInstance: vi.fn(),
      getPluginInstance: vi.fn(async () => pluginInstance),
      updatePluginInstance: vi.fn(),
    },
    getPublicPluginApiBaseUrl: vi.fn(async () => "https://api.example.com"),
    inferSourceHosts: vi.fn(),
    hostUtils: {
      extractSourceHostFromHeaders: vi.fn(),
      isHostAllowed: vi.fn(),
      normalizeHostCandidate: vi.fn(),
    },
    emailDeliveryService: {
      send: sendEmailMock,
    },
    emailTemplates: {
      buildConfirmationEmail: vi.fn(),
      buildCampaignEmail: vi.fn(async ({ subject }) => ({
        subject,
        text: "Text body",
        html: "<p>HTML body</p>",
      })),
    },
  });

  return {
    service,
    sendEmailMock,
    storedCampaigns,
    storedDeliveries,
    storedSubscribers,
  };
}

describe("newsletter campaign sending", () => {
  it("queues a draft campaign and snapshots the matching confirmed audience", async () => {
    const { service, storedCampaigns, storedDeliveries } = createHarness({
      campaigns: [
        {
          id: "campaign-1",
          status: "draft",
          audience: "mode_confirmed",
          mode: "newsletter",
          subject: "Launch update",
          body: "Ship it.",
        },
      ],
    });

    await expect(
      service.sendCampaign({
        organizationId: "org-1",
        projectSlug: "site-1",
        campaignId: "campaign-1",
      }),
    ).resolves.toEqual({
      campaignId: "campaign-1",
      status: "queued",
      recipientCount: 2,
    });

    expect(storedCampaigns[0]).toMatchObject({
      id: "campaign-1",
      status: "queued",
      recipientCount: 2,
    });
    expect(storedDeliveries).toHaveLength(2);
    expect(storedDeliveries.every((row) => row.status === "queued")).toBe(true);
    expect(storedDeliveries.map((row) => row.emailNormalized).sort()).toEqual([
      "alpha@example.com",
      "beta@example.com",
    ]);
  });

  it("processes queued deliveries and skips recipients who are no longer confirmed", async () => {
    const { service, sendEmailMock, storedCampaigns, storedDeliveries, storedSubscribers } =
      createHarness({
        campaigns: [
          {
            id: "campaign-1",
            status: "queued",
            audience: "all_confirmed",
            mode: "newsletter",
            subject: "Launch update",
            body: "Ship it.",
            recipientCount: 2,
            queuedAt: new Date("2026-04-17T12:00:00.000Z"),
          },
        ],
        deliveries: [
          {
            id: "delivery-1",
            campaignId: "campaign-1",
            subscriberId: "sub-1",
            email: "alpha@example.com",
            emailNormalized: "alpha@example.com",
            recipientName: "Alpha",
            status: "queued",
          },
          {
            id: "delivery-2",
            campaignId: "campaign-1",
            subscriberId: "sub-2",
            email: "beta@example.com",
            emailNormalized: "beta@example.com",
            recipientName: "Beta",
            status: "queued",
          },
        ],
      });

    const beta = storedSubscribers.find((row) => row.id === "sub-2");
    if (beta) beta.status = "unsubscribed";

    await expect(service.processQueuedCampaigns()).resolves.toBe(2);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(storedDeliveries.find((row) => row.id === "delivery-1")).toMatchObject({
      status: "sent",
      provider: "noop",
    });
    expect(storedDeliveries.find((row) => row.id === "delivery-2")).toMatchObject({
      status: "skipped",
    });
    expect(storedCampaigns[0]).toMatchObject({
      status: "sent",
    });
  });

  it("cancels queued deliveries that have not started yet", async () => {
    const { service, storedCampaigns, storedDeliveries } = createHarness({
      campaigns: [
        {
          id: "campaign-1",
          status: "queued",
          audience: "all_confirmed",
          mode: "newsletter",
          subject: "Launch update",
          body: "Ship it.",
          recipientCount: 2,
          queuedAt: new Date("2026-04-17T12:00:00.000Z"),
        },
      ],
      deliveries: [
        {
          id: "delivery-1",
          campaignId: "campaign-1",
          subscriberId: "sub-1",
          email: "alpha@example.com",
          emailNormalized: "alpha@example.com",
          status: "queued",
        },
        {
          id: "delivery-2",
          campaignId: "campaign-1",
          subscriberId: "sub-2",
          email: "beta@example.com",
          emailNormalized: "beta@example.com",
          status: "queued",
        },
      ],
    });

    await expect(
      service.cancelCampaign({
        organizationId: "org-1",
        projectSlug: "site-1",
        campaignId: "campaign-1",
      }),
    ).resolves.toEqual({
      campaignId: "campaign-1",
      status: "canceled",
    });

    expect(storedCampaigns[0]).toMatchObject({
      status: "canceled",
    });
    expect(storedDeliveries.every((row) => row.status === "canceled")).toBe(true);
  });
});
