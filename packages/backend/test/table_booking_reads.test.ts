import { describe, expect, it, vi } from "vitest";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createTableBookingPluginService } from "@vivd/plugin-table-booking/backend/service";

const tableBookingReservationTable = pgTable("table_booking_reservation_test", {
  id: text("id"),
  organizationId: text("organization_id"),
  projectSlug: text("project_slug"),
  pluginInstanceId: text("plugin_instance_id"),
  status: text("status"),
  serviceDate: text("service_date"),
  serviceStartAt: timestamp("service_start_at"),
  serviceEndAt: timestamp("service_end_at"),
  partySize: integer("party_size"),
  guestName: text("guest_name"),
  guestEmail: text("guest_email"),
  guestEmailNormalized: text("guest_email_normalized"),
  guestPhone: text("guest_phone"),
  notes: text("notes"),
  sourceHost: text("source_host"),
  sourcePath: text("source_path"),
  referrerHost: text("referrer_host"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  lastIpHash: text("last_ip_hash"),
  confirmedAt: timestamp("confirmed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: text("cancelled_by"),
  completedAt: timestamp("completed_at"),
  noShowAt: timestamp("no_show_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

const tableBookingActionTokenTable = pgTable("table_booking_action_token_test", {
  id: text("id"),
  reservationId: text("reservation_id"),
});

const projectMetaTable = pgTable("project_meta_test", {
  organizationId: text("organization_id"),
  slug: text("slug"),
  title: text("title"),
});

const projectPluginInstanceTable = pgTable("project_plugin_instance_test", {
  id: text("id"),
  pluginId: text("plugin_id"),
  publicToken: text("public_token"),
  status: text("status"),
});

type StoredReservationRow = {
  id: string;
  organizationId: string;
  projectSlug: string;
  pluginInstanceId: string;
  status: "confirmed" | "cancelled_by_guest" | "cancelled_by_staff" | "no_show" | "completed";
  serviceDate: string;
  serviceStartAt: Date | string;
  serviceEndAt: Date | string;
  partySize: number;
  guestName: string;
  guestEmail: string;
  guestEmailNormalized: string;
  guestPhone: string;
  notes: string | null;
  sourceHost: string | null;
  sourcePath: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  lastIpHash: string | null;
  confirmedAt: Date | string | null;
  cancelledAt: Date | string | null;
  cancelledBy: string | null;
  completedAt: Date | string | null;
  noShowAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
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

function createHarness(rows: StoredReservationRow[]) {
  const now = new Date("2026-04-16T12:00:00.000Z");
  const pluginInstance = {
    id: "plugin-1",
    organizationId: "default",
    projectSlug: "nudels-without-pesto",
    status: "enabled",
    configJson: {
      timezone: "Europe/Berlin",
      sourceHosts: [],
      redirectHostAllowlist: [],
      notificationRecipientEmails: [],
      partySize: { min: 1, max: 8 },
      leadTimeMinutes: 120,
      bookingHorizonDays: 60,
      defaultDurationMinutes: 90,
      cancellationCutoffMinutes: 120,
      collectNotes: true,
      weeklySchedule: [],
      dateOverrides: [],
    },
    publicToken: "public-token",
    createdAt: now,
    updatedAt: now,
  };

  const db = {
    query: {
      tableBookingReservation: {
        findMany: vi.fn(
          async ({ where }: { where?: unknown }) =>
            rows.filter((row) => matchesWhere(row, where)),
        ),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async (where?: unknown) => [
          { count: rows.filter((row) => matchesWhere(row, where)).length },
        ]),
      })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  };

  return createTableBookingPluginService({
    db: db as any,
    tables: {
      tableBookingReservation: tableBookingReservationTable,
      tableBookingActionToken: tableBookingActionTokenTable,
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
      buildGuestConfirmationEmail: vi.fn(),
      buildGuestCancellationEmail: vi.fn(),
      buildStaffNewBookingEmail: vi.fn(),
      buildStaffCancellationEmail: vi.fn(),
    },
  });
}

describe("table booking reads", () => {
  it("coerces string-backed timestamps for bookings and agenda reads", async () => {
    const service = createHarness([
      {
        id: "booking-1",
        organizationId: "default",
        projectSlug: "nudels-without-pesto",
        pluginInstanceId: "plugin-1",
        status: "confirmed",
        serviceDate: "2026-04-17",
        serviceStartAt: "2026-04-17T17:30:00.000Z",
        serviceEndAt: "2026-04-17T19:00:00.000Z",
        partySize: 2,
        guestName: "Felix Pahlke",
        guestEmail: "felix@example.com",
        guestEmailNormalized: "felix@example.com",
        guestPhone: "+4912345",
        notes: "Window seat",
        sourceHost: "test2.localhost",
        sourcePath: "/",
        referrerHost: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        lastIpHash: null,
        confirmedAt: "2026-04-16T19:18:23.613Z",
        cancelledAt: null,
        cancelledBy: null,
        completedAt: null,
        noShowAt: null,
        createdAt: "2026-04-16T19:18:23.613Z",
        updatedAt: "2026-04-16T19:18:23.613Z",
      },
    ]);

    const bookings = await service.listBookings({
      organizationId: "default",
      projectSlug: "nudels-without-pesto",
      status: "all",
      limit: 100,
      offset: 0,
    });
    const agenda = await service.getAgenda({
      organizationId: "default",
      projectSlug: "nudels-without-pesto",
      rangeDays: 7,
    });

    expect(bookings.total).toBe(1);
    expect(bookings.rows[0]).toMatchObject({
      id: "booking-1",
      serviceStartAt: "2026-04-17T17:30:00.000Z",
      serviceEndAt: "2026-04-17T19:00:00.000Z",
      createdAt: "2026-04-16T19:18:23.613Z",
      canGuestCancel: true,
    });
    expect(agenda.groups).toHaveLength(1);
    expect(agenda.groups[0]?.bookings[0]?.id).toBe("booking-1");
  });
});
