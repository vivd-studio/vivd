import type express from "express";
import type { Multer } from "multer";
import type { PluginRouteDefinition } from "@vivd/plugin-sdk";
import type {
  TableBookingAgendaPayload,
  TableBookingBookingsPayload,
  TableBookingSummaryPayload,
} from "../shared/summary";

export type TableBookingSourceChannel =
  | "online"
  | "phone"
  | "walk_in"
  | "staff_manual";
export type TableBookingCapacityAdjustmentMode =
  | "cover_holdback"
  | "effective_capacity_override"
  | "closed";

export interface TableBookingPluginInstanceRow {
  id: string;
  organizationId: string;
  projectSlug: string;
  status: string;
  configJson: unknown;
  publicToken: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TableBookingResolvedPluginEntitlement {
  state: "disabled" | "enabled" | "suspended";
  scope: "instance" | "organization" | "project" | "none";
  monthlyEventLimit: number | null;
  hardStop: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

export interface TableBookingPluginDatabase {
  query: Record<string, any>;
  select(...args: any[]): any;
  insert(table: any): any;
  update(table: any): any;
  delete(table: any): any;
  transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
}

export interface TableBookingPluginTables {
  tableBookingReservation: any;
  tableBookingActionToken: any;
  tableBookingCapacityAdjustment: any;
  projectMeta: any;
  projectPluginInstance: any;
}

export interface TableBookingPluginInstanceServicePort {
  ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "table_booking";
  }): Promise<{ row: TableBookingPluginInstanceRow; created: boolean }>;
  getPluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "table_booking";
  }): Promise<TableBookingPluginInstanceRow | null>;
  updatePluginInstance(options: {
    instanceId: string;
    configJson?: unknown;
    status?: string;
    updatedAt?: Date;
  }): Promise<TableBookingPluginInstanceRow | null>;
}

export interface TableBookingPluginEntitlementServicePort {
  resolveEffectiveEntitlement(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "table_booking";
  }): Promise<TableBookingResolvedPluginEntitlement>;
}

export interface TableBookingPublicPluginApiResolver {
  (options?: {
    requestHost?: string | null;
  }): Promise<string>;
}

export interface TableBookingSourceHeaders {
  origin?: string | null;
  referer?: string | null;
}

export interface TableBookingHostUtilsPort {
  extractSourceHostFromHeaders(
    headers: TableBookingSourceHeaders,
  ): string | null;
  isHostAllowed(sourceHost: string | null, allowlist: string[]): boolean;
  normalizeHostCandidate(raw: string | null | undefined): string | null;
}

export interface TableBookingEmailDeliveryServicePort {
  send(options: {
    to: string[];
    subject: string;
    text?: string;
    html?: string;
    metadata?: Record<string, string>;
  }): Promise<{
    accepted: boolean;
    provider: string;
    error?: string | null;
  }>;
}

export interface TableBookingEmailTemplatesPort {
  buildGuestConfirmationEmail(options: {
    projectTitle: string;
    guestName?: string | null;
    partySize: number;
    bookingDateTimeLabel: string;
    cancelUrl: string;
  }): Promise<{
    subject: string;
    text: string;
    html: string;
  }>;
  buildGuestCancellationEmail(options: {
    projectTitle: string;
    guestName?: string | null;
    partySize: number;
    bookingDateTimeLabel: string;
  }): Promise<{
    subject: string;
    text: string;
    html: string;
  }>;
  buildStaffNewBookingEmail(options: {
    projectTitle: string;
    bookingDateTimeLabel: string;
    partySize: number;
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    notes?: string | null;
  }): Promise<{
    subject: string;
    text: string;
    html: string;
  }>;
  buildStaffCancellationEmail(options: {
    projectTitle: string;
    bookingDateTimeLabel: string;
    partySize: number;
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    cancelledBy: "guest" | "staff";
    notes?: string | null;
  }): Promise<{
    subject: string;
    text: string;
    html: string;
  }>;
}

export interface TableBookingPluginServiceDeps {
  db: TableBookingPluginDatabase;
  tables: TableBookingPluginTables;
  pluginEntitlementService: TableBookingPluginEntitlementServicePort;
  projectPluginInstanceService: TableBookingPluginInstanceServicePort;
  getPublicPluginApiBaseUrl: TableBookingPublicPluginApiResolver;
  inferSourceHosts(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string[]>;
  hostUtils: TableBookingHostUtilsPort;
  emailDeliveryService: TableBookingEmailDeliveryServicePort;
  emailTemplates: TableBookingEmailTemplatesPort;
}

export interface TableBookingPluginIntegrationHooksDeps {
  db: TableBookingPluginDatabase;
  tables: Pick<
    TableBookingPluginTables,
    | "tableBookingReservation"
    | "tableBookingActionToken"
    | "tableBookingCapacityAdjustment"
  >;
}

export interface TableBookingCapacityAdjustmentRecord {
  id: string;
  serviceDate: string;
  startTime: string;
  endTime: string;
  mode: TableBookingCapacityAdjustmentMode;
  capacityValue: number | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TableBookingDayCapacityWindowRecord {
  key: string;
  startTime: string;
  endTime: string;
  slotIntervalMinutes: number;
  durationMinutes: number;
  baseCapacity: number;
  effectiveCapacity: number;
  bookedCovers: number;
  remainingCovers: number;
  isClosed: boolean;
  adjustments: TableBookingCapacityAdjustmentRecord[];
}

export interface TableBookingDayCapacityPayload {
  pluginId: "table_booking";
  enabled: boolean;
  serviceDate: string;
  timeZone: string | null;
  windows: TableBookingDayCapacityWindowRecord[];
  adjustments: TableBookingCapacityAdjustmentRecord[];
}

export interface TableBookingStaffReservationInput {
  bookingId?: string | null;
  organizationId: string;
  projectSlug: string;
  date: string;
  time: string;
  partySize: number;
  name: string;
  email: string;
  phone: string;
  notes?: string | null;
  sourceChannel: TableBookingSourceChannel;
  sendGuestNotification?: boolean;
  requestedByUserId?: string | null;
}

export interface TableBookingCapacityAdjustmentInput {
  adjustmentId?: string | null;
  organizationId: string;
  projectSlug: string;
  serviceDate: string;
  startTime: string;
  endTime: string;
  mode: TableBookingCapacityAdjustmentMode;
  capacityValue?: number | null;
  reason?: string | null;
  requestedByUserId?: string | null;
}

export interface TableBookingAvailabilityInput {
  token: string;
  date: string;
  partySize: number;
  sourceHost: string | null;
  origin: string | null;
  referer: string | null;
}

export interface TableBookingReservationMutationInput {
  token: string;
  date: string;
  time: string;
  partySize: number;
  name: string;
  email: string;
  phone: string;
  notes?: string | null;
  sourceHost: string | null;
  referer: string | null;
  origin: string | null;
  redirect: string | null;
  clientIp: string | null;
}

export interface TableBookingReservationMutationResult {
  bookingId: string;
  status: "confirmed" | "already_confirmed";
  serviceDate: string;
  time: string;
  partySize: number;
}

export interface TableBookingCancelPreviewResult {
  status:
    | "confirm"
    | "already_cancelled"
    | "cutoff_passed"
    | "invalid"
    | "expired";
  reservation?: {
    guestName: string;
    serviceDate: string;
    bookingDateTimeLabel: string;
    partySize: number;
  };
}

export interface TableBookingCancelByTokenResult {
  status:
    | "cancelled"
    | "already_cancelled"
    | "cutoff_passed"
    | "invalid"
    | "expired";
  redirectTarget?: string | null;
}

export interface TableBookingBackendRouteDefinition
  extends PluginRouteDefinition<
    express.Router,
    {
      upload: Pick<Multer, "none">;
    }
  > {}

export interface TableBookingPublicRouterDeps {
  upload: Pick<Multer, "none">;
  service: {
    listAvailability(options: TableBookingAvailabilityInput): Promise<{
      slots: Array<{
        time: string;
        label: string;
      }>;
    }>;
    createReservation(
      options: TableBookingReservationMutationInput,
    ): Promise<{
      redirectTarget: string | null;
      result: TableBookingReservationMutationResult;
    }>;
    getCancelPreview(options: {
      token: string;
    }): Promise<TableBookingCancelPreviewResult>;
    cancelByToken(options: {
      token: string;
      redirect: string | null;
    }): Promise<TableBookingCancelByTokenResult>;
  };
}

export interface TableBookingPluginServicePort {
  ensureTableBookingPlugin(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<{
    pluginId: "table_booking";
    instanceId: string;
    status: string;
    created: boolean;
    publicToken: string;
    config: Record<string, unknown>;
    snippets: {
      html: string;
      astro: string;
    };
  }>;
  getTableBookingInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<any>;
  updateTableBookingConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: Record<string, unknown>;
  }): Promise<any>;
  getTableBookingSummary(options: {
    organizationId: string;
    projectSlug: string;
    rangeDays: 7 | 30;
  }): Promise<TableBookingSummaryPayload>;
  listBookings(options: {
    organizationId: string;
    projectSlug: string;
    status: "all" | "confirmed" | "cancelled_by_guest" | "cancelled_by_staff" | "no_show" | "completed";
    sourceChannel?: "all" | TableBookingSourceChannel;
    search?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<TableBookingBookingsPayload>;
  getDayCapacity(options: {
    organizationId: string;
    projectSlug: string;
    serviceDate: string;
  }): Promise<TableBookingDayCapacityPayload>;
  upsertStaffReservation(options: TableBookingStaffReservationInput): Promise<{
    bookingId: string;
    status: "confirmed";
  }>;
  upsertCapacityAdjustment(
    options: TableBookingCapacityAdjustmentInput,
  ): Promise<TableBookingCapacityAdjustmentRecord>;
  deleteCapacityAdjustment(options: {
    organizationId: string;
    projectSlug: string;
    adjustmentId: string;
  }): Promise<{ adjustmentId: string }>;
  exportBookings(options: {
    organizationId: string;
    projectSlug: string;
    status: "all" | "confirmed" | "cancelled_by_guest" | "cancelled_by_staff" | "no_show" | "completed";
    sourceChannel?: "all" | TableBookingSourceChannel;
    search?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    filename: string;
    csv: string;
    total: number;
  }>;
  getAgenda(options: {
    organizationId: string;
    projectSlug: string;
    rangeDays: number;
  }): Promise<TableBookingAgendaPayload>;
  cancelBookingById(options: {
    organizationId: string;
    projectSlug: string;
    bookingId: string;
  }): Promise<{
    bookingId: string;
    status: "cancelled_by_staff" | "already_cancelled";
  }>;
  markBookingNoShow(options: {
    organizationId: string;
    projectSlug: string;
    bookingId: string;
  }): Promise<{
    bookingId: string;
    status: "no_show";
  }>;
  markBookingCompleted(options: {
    organizationId: string;
    projectSlug: string;
    bookingId: string;
  }): Promise<{
    bookingId: string;
    status: "completed";
  }>;
  listAvailability(options: TableBookingAvailabilityInput): Promise<{
    slots: Array<{
      time: string;
      label: string;
    }>;
  }>;
  createReservation(
    options: TableBookingReservationMutationInput,
  ): Promise<{
    redirectTarget: string | null;
    result: TableBookingReservationMutationResult;
  }>;
  getCancelPreview(options: {
    token: string;
  }): Promise<TableBookingCancelPreviewResult>;
  cancelByToken(options: {
    token: string;
    redirect: string | null;
  }): Promise<TableBookingCancelByTokenResult>;
}
