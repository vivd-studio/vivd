import type { TableBookingPluginConfig } from "./config";
import { canGuestCancelReservation } from "./serviceCapacity";
import { getServiceDateFallback, toDateTimeDisplayString, toIsoString } from "./serviceShared";
import type { CapacityAdjustmentRow, ReservationRow } from "./serviceTypes";
import type {
  TableBookingCapacityAdjustmentRecord,
} from "./ports";
import type { TableBookingRecord } from "../shared/summary";

export function toBookingRecord(
  reservation: ReservationRow,
  config: TableBookingPluginConfig,
  now: Date,
): TableBookingRecord {
  const serviceDateFallback = getServiceDateFallback(reservation.serviceDate);
  return {
    id: reservation.id,
    status: reservation.status,
    sourceChannel: reservation.sourceChannel,
    serviceDate: reservation.serviceDate,
    serviceStartAt: toDateTimeDisplayString(
      reservation.serviceStartAt,
      serviceDateFallback,
    ),
    serviceEndAt: toDateTimeDisplayString(
      reservation.serviceEndAt,
      serviceDateFallback,
    ),
    partySize: reservation.partySize,
    guestName: reservation.guestName,
    guestEmail: reservation.guestEmail,
    guestPhone: reservation.guestPhone,
    notes: reservation.notes ?? null,
    sourceHost: reservation.sourceHost ?? null,
    sourcePath: reservation.sourcePath ?? null,
    createdAt: toDateTimeDisplayString(reservation.createdAt, serviceDateFallback),
    cancelledAt: toIsoString(reservation.cancelledAt),
    completedAt: toIsoString(reservation.completedAt),
    noShowAt: toIsoString(reservation.noShowAt),
    canGuestCancel: canGuestCancelReservation(reservation, config, now),
  };
}

export function toCapacityAdjustmentRecord(
  adjustment: CapacityAdjustmentRow,
): TableBookingCapacityAdjustmentRecord {
  return {
    id: adjustment.id,
    serviceDate: adjustment.serviceDate,
    startTime: adjustment.startTime,
    endTime: adjustment.endTime,
    mode: adjustment.mode,
    capacityValue: adjustment.capacityValue ?? null,
    reason: adjustment.reason ?? null,
    createdAt:
      toIsoString(adjustment.createdAt) ??
      `${adjustment.serviceDate}T00:00:00.000Z`,
    updatedAt:
      toIsoString(adjustment.updatedAt) ??
      `${adjustment.serviceDate}T00:00:00.000Z`,
  };
}

function escapeCsvCell(value: string): string {
  if (/["\n,]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

export function buildBookingsCsv(rows: TableBookingRecord[]): string {
  const header = [
    "booking_id",
    "status",
    "source_channel",
    "service_date",
    "service_start_at",
    "service_end_at",
    "party_size",
    "guest_name",
    "guest_email",
    "guest_phone",
    "notes",
    "source_host",
    "source_path",
    "created_at",
  ];

  const lines = rows.map((row) =>
    [
      row.id,
      row.status,
      row.sourceChannel,
      row.serviceDate,
      row.serviceStartAt,
      row.serviceEndAt,
      String(row.partySize),
      row.guestName,
      row.guestEmail,
      row.guestPhone,
      row.notes ?? "",
      row.sourceHost ?? "",
      row.sourcePath ?? "",
      row.createdAt,
    ]
      .map((value) => escapeCsvCell(value))
      .join(","),
  );

  return [header.join(","), ...lines].join("\n");
}
