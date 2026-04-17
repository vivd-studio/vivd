import type {
  TableBookingCapacityAdjustmentMode,
  TableBookingSourceChannel,
} from "./ports";

export type TableBookingStatus =
  | "confirmed"
  | "cancelled_by_guest"
  | "cancelled_by_staff"
  | "no_show"
  | "completed";

export type ReservationRow = {
  id: string;
  organizationId: string;
  projectSlug: string;
  pluginInstanceId: string;
  status: TableBookingStatus;
  serviceDate: string;
  serviceStartAt: Date;
  serviceEndAt: Date;
  partySize: number;
  guestName: string;
  guestEmail: string;
  guestEmailNormalized: string;
  guestPhone: string;
  notes: string | null;
  sourceChannel: TableBookingSourceChannel;
  sourceHost: string | null;
  sourcePath: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  lastIpHash: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  completedAt: Date | null;
  noShowAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyReservationRow = Omit<
  ReservationRow,
  "sourceChannel" | "createdByUserId" | "updatedByUserId"
>;

export type LegacyGuestTokenLookupRow = LegacyReservationRow & {
  tokenId: string;
  tokenExpiresAt: Date;
  tokenUsedAt: Date | null;
};

export type CapacityAdjustmentRow = {
  id: string;
  organizationId: string;
  projectSlug: string;
  pluginInstanceId: string;
  serviceDate: string;
  startTime: string;
  endTime: string;
  mode: TableBookingCapacityAdjustmentMode;
  capacityValue: number | null;
  reason: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function buildLegacyReservationSelection(table: any) {
  return {
    id: table.id,
    organizationId: table.organizationId,
    projectSlug: table.projectSlug,
    pluginInstanceId: table.pluginInstanceId,
    status: table.status,
    serviceDate: table.serviceDate,
    serviceStartAt: table.serviceStartAt,
    serviceEndAt: table.serviceEndAt,
    partySize: table.partySize,
    guestName: table.guestName,
    guestEmail: table.guestEmail,
    guestEmailNormalized: table.guestEmailNormalized,
    guestPhone: table.guestPhone,
    notes: table.notes,
    sourceHost: table.sourceHost,
    sourcePath: table.sourcePath,
    referrerHost: table.referrerHost,
    utmSource: table.utmSource,
    utmMedium: table.utmMedium,
    utmCampaign: table.utmCampaign,
    lastIpHash: table.lastIpHash,
    confirmedAt: table.confirmedAt,
    cancelledAt: table.cancelledAt,
    cancelledBy: table.cancelledBy,
    completedAt: table.completedAt,
    noShowAt: table.noShowAt,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
  };
}

export function toReservationRowFromLegacy(
  row: LegacyReservationRow,
): ReservationRow {
  return {
    ...row,
    sourceChannel: "online",
    createdByUserId: null,
    updatedByUserId: null,
  };
}
