import { describe, expect, it, vi } from "vitest";
import { timestamp, integer, pgTable, text } from "drizzle-orm/pg-core";
import {
  NewsletterCampaignStateError,
  createNewsletterPluginService,
} from "@vivd/plugin-newsletter/backend/service";

const newsletterSubscriberTable = pgTable("newsletter_subscriber_test", {
  id: text("id"),
  organizationId: text("organization_id"),
  projectSlug: text("project_slug"),
  pluginInstanceId: text("plugin_instance_id"),
  status: text("status"),
  mode: text("mode"),
  updatedAt: timestamp("updated_at"),
});

const newsletterActionTokenTable = pgTable("newsletter_action_token_test", {
  id: text("id"),
  subscriberId: text("subscriber_id"),
});

const newsletterCampaignTable = pgTable("newsletter_campaign_test", {
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

const newsletterCampaignDeliveryTable = pgTable("newsletter_campaign_delivery_test", {
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

const projectMetaTable = pgTable("project_meta_test", {
  organizationId: text("organization_id"),
  slug: text("slug"),
});

const projectPluginInstanceTable = pgTable("project_plugin_instance_test", {
  id: text("id"),
  pluginId: text("plugin_id"),
  publicToken: text("public_token"),
  status: text("status"),
});

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

type StoredSubscriberRow = {
  id: string;
  organizationId: string;
  projectSlug: string;
  pluginInstanceId: string;
  status: string;
  mode: "newsletter" | "waitlist";
  updatedAt: Date;
};

function toRowKey(columnName: string): string {
  return columnName.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function collectEqFilters(node: unknown, filters: Record<string, unknown> = {}) {
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
      filters[toRowKey(chunk.name)] =
        paramChunk && Object.prototype.hasOwnProperty.call(paramChunk, "value")
          ? paramChunk.value
          : paramChunk;
    }

    collectEqFilters(chunk, filters);
  }

  return filters;
}

function matchesWhere<T extends Record<string, unknown>>(row: T, where: unknown): boolean {
  const filters = collectEqFilters(where);
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

function sortCampaignRows(rows: StoredCampaignRow[]): StoredCampaignRow[] {
  return [...rows].sort((left, right) => {
    const timeDiff = right.updatedAt.getTime() - left.updatedAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return left.subject.localeCompare(right.subject);
  });
}

function createHarness(options?: {
  campaigns?: Partial<StoredCampaignRow>[];
  subscribers?: Partial<StoredSubscriberRow>[];
}) {
  const now = new Date("2026-04-16T12:00:00.000Z");
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

  const tables = {
    newsletterSubscriber: newsletterSubscriberTable,
    newsletterActionToken: newsletterActionTokenTable,
    newsletterCampaign: newsletterCampaignTable,
    newsletterCampaignDelivery: newsletterCampaignDeliveryTable,
    projectMeta: projectMetaTable,
    projectPluginInstance: projectPluginInstanceTable,
  } as const;

  const storedSubscribers: StoredSubscriberRow[] = (
    options?.subscribers ?? [
      { id: "sub-1", status: "confirmed", mode: "newsletter" },
      { id: "sub-2", status: "confirmed", mode: "newsletter" },
      { id: "sub-3", status: "confirmed", mode: "waitlist" },
      { id: "sub-4", status: "pending", mode: "newsletter" },
    ]
  ).map((row, index) => ({
    id: row.id ?? `sub-${index + 1}`,
    organizationId: "org-1",
    projectSlug: "site-1",
    pluginInstanceId: "plugin-1",
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
  const storedDeliveries: StoredDeliveryRow[] = [];

  function getRowsForTable(table: unknown): Array<Record<string, unknown>> {
    if (table === tables.newsletterCampaign) return storedCampaigns;
    if (table === tables.newsletterSubscriber) return storedSubscribers;
    if (table === tables.newsletterCampaignDelivery) return storedDeliveries;
    return [];
  }

  const db = {
    query: {
      newsletterCampaign: {
        findFirst: vi.fn(async ({ where }: { where?: unknown }) => {
          const rows = storedCampaigns.filter((row) => matchesWhere(row, where));
          return rows[0] ?? null;
        }),
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
    },
    select: vi.fn(() => ({
      from: vi.fn((table) => ({
        where: vi.fn((where?: unknown) => ({
          groupBy: vi.fn(async () => {
            if (table !== tables.newsletterCampaignDelivery) return [];
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
            return Promise.resolve([
              {
                count: getRowsForTable(table).filter((row) => matchesWhere(row, where)).length,
              },
            ]).then(onFulfilled);
          },
        })),
      })),
    })),
    insert: vi.fn((table) => ({
      values: vi.fn((values) => ({
        returning: vi.fn(async () => {
          if (table !== tables.newsletterCampaign) return [];
          const entries = Array.isArray(values) ? values : [values];
          return entries.map((entry) => {
            const row: StoredCampaignRow = {
              id: entry.id,
              organizationId: entry.organizationId,
              projectSlug: entry.projectSlug,
              pluginInstanceId: entry.pluginInstanceId,
              mode: entry.mode,
              status: entry.status,
              audience: entry.audience,
              subject: entry.subject,
              body: entry.body,
              estimatedRecipientCount: entry.estimatedRecipientCount,
              createdAt: entry.createdAt ?? now,
              updatedAt: entry.updatedAt ?? now,
            };
            storedCampaigns.push(row);
            return row;
          });
        }),
      })),
    })),
    update: vi.fn((table) => ({
      set: vi.fn((updates) => ({
        where: vi.fn((where) => ({
          returning: vi.fn(async () => {
            if (table !== tables.newsletterCampaign) return [];
            return storedCampaigns
              .filter((row) => matchesWhere(row, where))
              .map((row) => {
                Object.assign(row, updates);
                return { ...row };
              });
          }),
        })),
      })),
    })),
    delete: vi.fn((table) => ({
      where: vi.fn(async (where) => {
        if (table !== tables.newsletterCampaign) return;
        for (let index = storedCampaigns.length - 1; index >= 0; index -= 1) {
          if (matchesWhere(storedCampaigns[index]!, where)) {
            storedCampaigns.splice(index, 1);
          }
        }
      }),
    })),
    transaction: vi.fn(),
  };

  const service = createNewsletterPluginService({
    db: db as any,
    tables: tables as any,
    pluginEntitlementService: {
      resolveEffectiveEntitlement: vi.fn(),
    },
    projectPluginInstanceService: {
      ensurePluginInstance: vi.fn(),
      getPluginInstance: vi.fn(async () => pluginInstance),
      updatePluginInstance: vi.fn(),
    },
    getPublicPluginApiBaseUrl: vi.fn(),
    inferSourceHosts: vi.fn(),
    hostUtils: {
      extractSourceHostFromHeaders: vi.fn(),
      isHostAllowed: vi.fn(),
      normalizeHostCandidate: vi.fn(),
    },
    emailDeliveryService: {
      send: vi.fn(),
    },
    emailTemplates: {
      buildConfirmationEmail: vi.fn(),
      buildCampaignEmail: vi.fn(),
    },
  });

  return {
    service,
    storedCampaigns,
  };
}

describe("newsletter campaign drafts", () => {
  it("creates, updates, filters, paginates, and deletes the targeted draft campaign", async () => {
    const { service, storedCampaigns } = createHarness({
      campaigns: [
        {
          id: "campaign-a",
          subject: "Keep me",
          body: "Unchanged body",
          status: "draft",
          audience: "all_confirmed",
          estimatedRecipientCount: 3,
          updatedAt: new Date("2026-04-14T10:00:00.000Z"),
        },
        {
          id: "campaign-b",
          subject: "Update me",
          body: "Old draft body",
          status: "draft",
          audience: "mode_confirmed",
          estimatedRecipientCount: 2,
          updatedAt: new Date("2026-04-14T11:00:00.000Z"),
        },
        {
          id: "campaign-sent",
          subject: "Already sent",
          body: "Sent campaign body",
          status: "sent",
          audience: "all_confirmed",
          estimatedRecipientCount: 3,
          updatedAt: new Date("2026-04-13T09:00:00.000Z"),
        },
      ],
    });

    const created = await service.saveCampaignDraft({
      organizationId: "org-1",
      projectSlug: "site-1",
      campaignId: null,
      subject: "Launch update",
      body: "We shipped the first waitlist release.",
      audience: "mode_confirmed",
    });

    expect(created).toMatchObject({
      status: "draft",
      estimatedRecipientCount: 2,
    });

    const updated = await service.saveCampaignDraft({
      organizationId: "org-1",
      projectSlug: "site-1",
      campaignId: "campaign-b",
      subject: "Updated subject",
      body: "Updated body",
      audience: "all_confirmed",
    });

    expect(updated).toMatchObject({
      campaignId: "campaign-b",
      status: "draft",
      estimatedRecipientCount: 3,
    });
    expect(storedCampaigns.find((row) => row.id === "campaign-a")).toMatchObject({
      subject: "Keep me",
      body: "Unchanged body",
      audience: "all_confirmed",
      estimatedRecipientCount: 3,
    });
    expect(storedCampaigns.find((row) => row.id === "campaign-b")).toMatchObject({
      subject: "Updated subject",
      body: "Updated body",
      audience: "all_confirmed",
      estimatedRecipientCount: 3,
    });

    const firstDraftPage = await service.listCampaigns({
      organizationId: "org-1",
      projectSlug: "site-1",
      status: "draft",
      limit: 1,
      offset: 0,
    });
    expect(firstDraftPage).toMatchObject({
      pluginId: "newsletter",
      enabled: true,
      total: 3,
      currentMode: "newsletter",
      audienceOptions: {
        allConfirmed: 3,
        modeConfirmed: 2,
      },
    });
    expect(firstDraftPage.rows).toHaveLength(1);
    expect(firstDraftPage.rows[0]?.status).toBe("draft");

    const secondDraftPage = await service.listCampaigns({
      organizationId: "org-1",
      projectSlug: "site-1",
      status: "draft",
      limit: 1,
      offset: 1,
    });
    expect(secondDraftPage.rows).toHaveLength(1);
    expect(secondDraftPage.rows[0]?.id).not.toBe(firstDraftPage.rows[0]?.id);
    expect(secondDraftPage.rows.every((row) => row.status === "draft")).toBe(true);
    expect(secondDraftPage.rows.some((row) => row.id === "campaign-sent")).toBe(false);

    await expect(
      service.deleteCampaignDraft({
        organizationId: "org-1",
        projectSlug: "site-1",
        campaignId: created.campaignId,
      }),
    ).resolves.toEqual({
      campaignId: created.campaignId,
      status: "deleted",
    });

    expect(storedCampaigns.some((row) => row.id === created.campaignId)).toBe(false);
    expect(storedCampaigns.some((row) => row.id === "campaign-b")).toBe(true);
    expect(storedCampaigns.some((row) => row.id === "campaign-sent")).toBe(true);
  });

  it("rejects editing or deleting non-draft campaigns", async () => {
    const { service } = createHarness({
      campaigns: [
        {
          id: "campaign-sent",
          subject: "Already sent",
          body: "Sent campaign body",
          status: "sent",
          audience: "all_confirmed",
          estimatedRecipientCount: 3,
        },
      ],
    });

    await expect(
      service.saveCampaignDraft({
        organizationId: "org-1",
        projectSlug: "site-1",
        campaignId: "campaign-sent",
        subject: "Retry",
        body: "Retry body",
        audience: "mode_confirmed",
      }),
    ).rejects.toBeInstanceOf(NewsletterCampaignStateError);

    await expect(
      service.deleteCampaignDraft({
        organizationId: "org-1",
        projectSlug: "site-1",
        campaignId: "campaign-sent",
      }),
    ).rejects.toBeInstanceOf(NewsletterCampaignStateError);
  });
});
