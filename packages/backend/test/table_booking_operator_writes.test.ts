import { describe, expect, it, vi } from "vitest";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createTableBookingOperatorService } from "../../../plugins/native/table-booking/src/backend/serviceOperators";

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
  sourceChannel: text("source_channel"),
  sourceHost: text("source_host"),
  sourcePath: text("source_path"),
  referrerHost: text("referrer_host"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  lastIpHash: text("last_ip_hash"),
  createdByUserId: text("created_by_user_id"),
  updatedByUserId: text("updated_by_user_id"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

const tableBookingCapacityAdjustmentTable = pgTable(
  "table_booking_capacity_adjustment_test",
  {
    id: text("id"),
    organizationId: text("organization_id"),
    projectSlug: text("project_slug"),
    pluginInstanceId: text("plugin_instance_id"),
    serviceDate: text("service_date"),
    startTime: text("start_time"),
    endTime: text("end_time"),
    mode: text("mode"),
    capacityValue: integer("capacity_value"),
    reason: text("reason"),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
);

function createMissingOperatorStorageError() {
  const error = new Error(
    'column "source_channel" does not exist',
  ) as Error & { code?: string };
  error.code = "42703";
  return error;
}

function createQueryReturning(rows: unknown[], options?: { error?: Error }) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    offset: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      (options?.error
        ? Promise.reject(options.error)
        : Promise.resolve(rows)
      ).then(resolve, reject),
  };

  return query;
}

function createHarness(options?: {
  legacyOperatorColumnsOnly?: boolean;
}) {
  const insertedValues: Record<string, unknown>[] = [];
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
      weeklySchedule: [
        {
          dayOfWeek: 6,
          periods: [
            {
              startTime: "17:00",
              endTime: "22:00",
              slotIntervalMinutes: 30,
              maxConcurrentCovers: 28,
            },
          ],
        },
      ],
      dateOverrides: [],
    },
    publicToken: "public-token",
    createdAt: new Date("2026-04-16T12:00:00.000Z"),
    updatedAt: new Date("2026-04-16T12:00:00.000Z"),
  };

  const tx = {
    select: vi.fn(() => createQueryReturning([])),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          insertedValues.push(values);
          return [
            {
              ...values,
              sourceChannel: values.sourceChannel ?? "online",
              createdByUserId: values.createdByUserId ?? null,
              updatedByUserId: values.updatedByUserId ?? null,
              confirmedAt: values.confirmedAt ?? new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];
        },
      }),
    })),
    update: vi.fn(),
  };

  const db = {
    select: vi.fn(() =>
      createQueryReturning([], {
        error: options?.legacyOperatorColumnsOnly
          ? createMissingOperatorStorageError()
          : undefined,
      }),
    ),
    query: {
      tableBookingCapacityAdjustment: {
        findFirst: vi.fn(async () => null),
      },
    },
    transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  const service = createTableBookingOperatorService({
    db: db as any,
    tables: {
      tableBookingReservation: tableBookingReservationTable,
      tableBookingCapacityAdjustment: tableBookingCapacityAdjustmentTable,
    } as any,
    pluginEntitlementService: {
      resolveEffectiveEntitlement: vi.fn(async () => ({
        state: "enabled",
        scope: "project",
        monthlyEventLimit: null,
        hardStop: false,
        turnstileEnabled: false,
        turnstileSiteKey: null,
        turnstileSecretKey: null,
      })),
    },
    projectPluginInstanceService: {
      getPluginInstance: vi.fn(async () => pluginInstance),
    },
    deps: {
      emailDeliveryService: { send: vi.fn() },
      emailTemplates: {
        buildGuestConfirmationEmail: vi.fn(),
        buildGuestCancellationEmail: vi.fn(),
        buildStaffNewBookingEmail: vi.fn(),
        buildStaffCancellationEmail: vi.fn(),
      },
    },
    findReservationById: vi.fn(async () => null),
    enforceMonthlyLimit: vi.fn(async () => undefined),
    readProjectTitle: vi.fn(async () => "Nudels without Pesto"),
    resolvePublicEndpoints: vi.fn(async () => ({
      availabilityEndpoint: "https://api.example.com/availability",
      bookEndpoint: "https://api.example.com/book",
      cancelEndpoint: "https://api.example.com/cancel",
    })),
    listCapacityAdjustmentsForDate: vi.fn(async () => []),
    listReservationsForDate: vi.fn(async () => []),
    ensureGuestCancelToken: vi.fn(async () => "cancel-token"),
  } as any);

  return { insertedValues, service };
}

describe("table booking operator writes", () => {
  it("stores phone-only reservations against legacy reservation schemas", async () => {
    const { insertedValues, service } = createHarness({
      legacyOperatorColumnsOnly: true,
    });

    const result = await service.upsertStaffReservation({
      organizationId: "default",
      projectSlug: "nudels-without-pesto",
      date: "2026-04-18",
      time: "17:00",
      partySize: 2,
      name: "Felix Pahlke",
      email: "",
      phone: "+4912345",
      notes: "Walk-in",
      sourceChannel: "phone",
      sendGuestNotification: false,
      requestedByUserId: "user-1",
    });

    expect(result.status).toBe("confirmed");
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      guestName: "Felix Pahlke",
      guestEmail: "",
      guestEmailNormalized: "",
      guestPhone: "+4912345",
      notes: "Walk-in",
      status: "confirmed",
    });
    expect(insertedValues[0]).not.toHaveProperty("sourceChannel");
    expect(insertedValues[0]).not.toHaveProperty("createdByUserId");
    expect(insertedValues[0]).not.toHaveProperty("updatedByUserId");
  });

  it("rejects guest email notifications when no email address was provided", async () => {
    const { service } = createHarness();

    await expect(
      service.upsertStaffReservation({
        organizationId: "default",
        projectSlug: "nudels-without-pesto",
        date: "2026-04-18",
        time: "17:00",
        partySize: 2,
        name: "Felix Pahlke",
        email: "",
        phone: "+4912345",
        notes: null,
        sourceChannel: "phone",
        sendGuestNotification: true,
        requestedByUserId: "user-1",
      }),
    ).rejects.toThrow("Guest confirmation email requires an email address.");
  });
});
