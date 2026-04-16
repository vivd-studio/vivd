import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  tableBookingIsoDateSchema,
  tableBookingPluginConfigSchema,
  tableBookingTimeStringSchema,
  type TableBookingPluginConfig,
} from "./config";
import {
  formatDateInTimeZone,
  formatDateTimeLabelInTimeZone,
  formatTimeInTimeZone,
  listCandidateSlots,
  overlaps,
  resolveServicePeriodsForDate,
  zonedDateTimeToUtc,
} from "./schedule";
import {
  getTableBookingAvailabilityEndpoint,
  getTableBookingBookEndpoint,
  getTableBookingCancelEndpoint,
} from "./publicApi";
import { getTableBookingSnippets } from "./snippets";
import type {
  TableBookingAvailabilityInput,
  TableBookingCancelByTokenResult,
  TableBookingCancelPreviewResult,
  TableBookingPluginInstanceRow,
  TableBookingPluginServiceDeps,
  TableBookingReservationMutationInput,
  TableBookingReservationMutationResult,
} from "./ports";
import type {
  TableBookingAgendaPayload,
  TableBookingBookingsPayload,
  TableBookingRecord,
  TableBookingSummaryPayload,
} from "../shared/summary";

const emailSchema = z.string().trim().email();
const phoneSchema = z.string().trim().min(3).max(64);
const guestNameSchema = z.string().trim().min(1).max(120);
const partySizeSchema = z.number().int().min(1).max(50);
const TOKEN_RATE_LIMIT_PER_MINUTE = 30;
const IP_RATE_LIMIT_PER_HOUR = 25;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const CANCEL_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type TableBookingStatus =
  | "confirmed"
  | "cancelled_by_guest"
  | "cancelled_by_staff"
  | "no_show"
  | "completed";

type ReservationRow = {
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
  sourceHost: string | null;
  sourcePath: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  lastIpHash: string | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  completedAt: Date | null;
  noShowAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeTableBookingConfig(configJson: unknown): TableBookingPluginConfig {
  const parsed = tableBookingPluginConfigSchema.safeParse(configJson ?? {});
  if (parsed.success) return parsed.data;
  return tableBookingPluginConfigSchema.parse({ timezone: "UTC" });
}

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = (value || "").trim().slice(0, maxLength);
  return normalized || null;
}

function normalizeRequiredText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
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

function coerceDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function toIsoString(value: unknown): string | null {
  const parsed = coerceDateValue(value);
  return parsed ? parsed.toISOString() : null;
}

function toDateTimeDisplayString(value: unknown, fallback: string): string {
  const isoString = toIsoString(value);
  if (isoString) return isoString;
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function getServiceDateFallback(value: string): string {
  return toIsoString(`${value}T00:00:00.000Z`) ?? value;
}

function toCount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeHostWithUtils(
  raw: string | null | undefined,
  deps: TableBookingPluginServiceDeps,
): string | null {
  return deps.hostUtils.normalizeHostCandidate(raw);
}

function normalizeHostAllowlist(
  values: string[],
  deps: TableBookingPluginServiceDeps,
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
  config: TableBookingPluginConfig,
  inferredSourceHosts: string[],
  deps: TableBookingPluginServiceDeps,
): string[] {
  const configured = normalizeHostAllowlist(config.sourceHosts, deps);
  if (configured.length > 0) return configured;
  return normalizeHostAllowlist(inferredSourceHosts, deps);
}

function resolveEffectiveRedirectHosts(
  config: TableBookingPluginConfig,
  effectiveSourceHosts: string[],
  deps: TableBookingPluginServiceDeps,
): string[] {
  const configured = normalizeHostAllowlist(config.redirectHostAllowlist, deps);
  if (configured.length > 0) return configured;
  return effectiveSourceHosts;
}

function resolveRedirectTarget(
  rawRedirect: string | null | undefined,
  allowlist: string[],
  deps: TableBookingPluginServiceDeps,
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

function stripDefaultPort(host: string): string {
  if (host.endsWith(":80")) return host.slice(0, -3);
  if (host.endsWith(":443")) return host.slice(0, -4);
  return host;
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

function extractHostname(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return "";

  if (normalized.startsWith("[")) {
    const closingIndex = normalized.indexOf("]");
    return closingIndex > 0 ? normalized.slice(1, closingIndex) : normalized;
  }

  return normalized.split(":")[0] || "";
}

function isLocalOrLoopbackHostname(hostname: string): boolean {
  if (!hostname) return false;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function isStudioRuntimePath(pathname: string): boolean {
  return (
    pathname === "/_studio" ||
    pathname.startsWith("/_studio/") ||
    pathname === "/vivd-studio" ||
    pathname.startsWith("/vivd-studio/")
  );
}

function resolveStudioPublicHosts(
  deps: TableBookingPluginServiceDeps,
): string[] {
  const flyStudioApp = (process.env.FLY_STUDIO_APP || "").trim();
  return Array.from(
    new Set(
      [
        process.env.FLY_STUDIO_PUBLIC_HOST,
        flyStudioApp ? `${flyStudioApp}.fly.dev` : null,
      ]
        .map((value) => normalizeHostWithUtils(value, deps))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function isDurableInferredSuccessRedirectUrl(
  url: URL,
  deps: TableBookingPluginServiceDeps,
): boolean {
  const hostname = extractHostname(url.host);
  if (isLocalOrLoopbackHostname(hostname)) return false;
  if (isStudioRuntimePath(url.pathname || "/")) return false;

  const normalizedHost = normalizeHostWithUtils(url.host, deps);
  if (!normalizedHost) return false;

  const studioPublicHosts = resolveStudioPublicHosts(deps);
  if (
    studioPublicHosts.length > 0 &&
    deps.hostUtils.isHostAllowed(normalizedHost, studioPublicHosts)
  ) {
    return false;
  }

  return true;
}

export function resolveDefaultSuccessRedirectTarget(options: {
  rawReferer?: string | null;
  rawOrigin?: string | null;
  allowlist: string[];
  deps: TableBookingPluginServiceDeps;
}): string | null {
  if (options.allowlist.length === 0) return null;

  for (const rawCandidate of [options.rawReferer, options.rawOrigin]) {
    const candidate = (rawCandidate || "").trim();
    if (!candidate) continue;

    try {
      const url = new URL(candidate);
      const host = normalizeHostWithUtils(url.host, options.deps);
      if (!options.deps.hostUtils.isHostAllowed(host, options.allowlist)) continue;
      if (!isDurableInferredSuccessRedirectUrl(url, options.deps)) {
        return null;
      }
      url.searchParams.set("booking", "success");
      url.searchParams.set("_vivd_booking", "success");
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

function startOfUtcMonth(): Date {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return monthStart;
}

function endOfRangeFromDate(date: Date, rangeDays: number): Date {
  return new Date(date.getTime() + rangeDays * 24 * 60 * 60 * 1000);
}

export class TableBookingPluginNotEnabledError extends Error {
  constructor() {
    super(
      "Table Booking is not enabled for this project. Ask a super-admin to enable it first.",
    );
    this.name = "TableBookingPluginNotEnabledError";
  }
}

export class TableBookingSourceHostError extends Error {
  constructor() {
    super("Booking source host is not allowed for this project.");
    this.name = "TableBookingSourceHostError";
  }
}

export class TableBookingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableBookingValidationError";
  }
}

export class TableBookingCapacityError extends Error {
  constructor() {
    super("That time slot is no longer available. Please choose another time.");
    this.name = "TableBookingCapacityError";
  }
}

export class TableBookingQuotaExceededError extends Error {
  constructor() {
    super("Monthly booking limit reached for this project.");
    this.name = "TableBookingQuotaExceededError";
  }
}

export class TableBookingReservationNotFoundError extends Error {
  constructor(bookingId: string) {
    super(`Booking not found: ${bookingId}`);
    this.name = "TableBookingReservationNotFoundError";
  }
}

async function readProjectTitle(
  deps: TableBookingPluginServiceDeps,
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
  deps: TableBookingPluginServiceDeps;
  pluginInstanceId: string;
  since: Date;
  ipHash: string | null;
}) {
  const tokenRows = await options.deps.db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(options.deps.tables.tableBookingReservation)
    .where(
      and(
        eq(
          options.deps.tables.tableBookingReservation.pluginInstanceId,
          options.pluginInstanceId,
        ),
        gte(options.deps.tables.tableBookingReservation.createdAt, options.since),
      ),
    );

  const ipRows =
    options.ipHash
      ? await options.deps.db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(options.deps.tables.tableBookingReservation)
          .where(
            and(
              eq(
                options.deps.tables.tableBookingReservation.pluginInstanceId,
                options.pluginInstanceId,
              ),
              eq(
                options.deps.tables.tableBookingReservation.lastIpHash,
                options.ipHash,
              ),
              gte(options.deps.tables.tableBookingReservation.createdAt, options.since),
            ),
          )
      : [];

  return {
    tokenCount: toCount(tokenRows[0]?.count),
    ipCount: toCount(ipRows[0]?.count),
  };
}

async function listReservationsForDate(
  dbLike: {
    select(...args: any[]): any;
  },
  tables: TableBookingPluginServiceDeps["tables"],
  pluginInstanceId: string,
  serviceDate: string,
): Promise<ReservationRow[]> {
  return dbLike
    .select()
    .from(tables.tableBookingReservation)
    .where(
      and(
        eq(tables.tableBookingReservation.pluginInstanceId, pluginInstanceId),
        eq(tables.tableBookingReservation.serviceDate, serviceDate),
      ),
    )
    .orderBy(asc(tables.tableBookingReservation.serviceStartAt));
}

function canGuestCancelReservation(
  reservation: Pick<ReservationRow, "status" | "serviceStartAt">,
  config: TableBookingPluginConfig,
  now: Date,
): boolean {
  if (reservation.status !== "confirmed") return false;
  const serviceStartAt = coerceDateValue(reservation.serviceStartAt);
  if (!serviceStartAt) return false;
  return (
    serviceStartAt.getTime() - now.getTime() >=
    config.cancellationCutoffMinutes * 60_000
  );
}

function toBookingRecord(
  reservation: ReservationRow,
  config: TableBookingPluginConfig,
  now: Date,
): TableBookingRecord {
  const serviceDateFallback = getServiceDateFallback(reservation.serviceDate);
  return {
    id: reservation.id,
    status: reservation.status,
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

function validateBookingWindow(options: {
  config: TableBookingPluginConfig;
  date: string;
  startAt: Date;
  now: Date;
}) {
  const horizonEnd = endOfRangeFromDate(options.now, options.config.bookingHorizonDays);
  if (options.startAt > horizonEnd) {
    throw new TableBookingValidationError(
      "That date is outside the online booking window.",
    );
  }

  if (
    options.startAt.getTime() - options.now.getTime() <
    options.config.leadTimeMinutes * 60_000
  ) {
    throw new TableBookingValidationError(
      "That time is too soon for online booking. Please choose a later slot.",
    );
  }
}

function validateAvailabilityInput(options: {
  date: string;
  partySize: number;
  config: TableBookingPluginConfig;
}) {
  const dateParsed = tableBookingIsoDateSchema.safeParse(options.date);
  if (!dateParsed.success) {
    throw new TableBookingValidationError("Date must use YYYY-MM-DD format.");
  }

  if (
    options.partySize < options.config.partySize.min ||
    options.partySize > options.config.partySize.max
  ) {
    throw new TableBookingValidationError(
      `Party size must be between ${options.config.partySize.min} and ${options.config.partySize.max}.`,
    );
  }
}

function validateBookingPayload(options: {
  input: TableBookingReservationMutationInput;
  config: TableBookingPluginConfig;
}) {
  validateAvailabilityInput({
    date: options.input.date,
    partySize: options.input.partySize,
    config: options.config,
  });

  const timeParsed = tableBookingTimeStringSchema.safeParse(options.input.time);
  if (!timeParsed.success) {
    throw new TableBookingValidationError("Time must use HH:MM format.");
  }

  const emailParsed = emailSchema.safeParse(options.input.email);
  if (!emailParsed.success) {
    throw new TableBookingValidationError("A valid email address is required.");
  }

  const phoneParsed = phoneSchema.safeParse(options.input.phone);
  if (!phoneParsed.success) {
    throw new TableBookingValidationError("A valid phone number is required.");
  }

  const nameParsed = guestNameSchema.safeParse(options.input.name);
  if (!nameParsed.success) {
    throw new TableBookingValidationError("Guest name is required.");
  }

  const sizeParsed = partySizeSchema.safeParse(options.input.partySize);
  if (!sizeParsed.success) {
    throw new TableBookingValidationError("Party size must be a whole number.");
  }
}

async function sendTransactionalEmail(
  deps: TableBookingPluginServiceDeps,
  options: {
    to: string[];
    subject: string;
    text: string;
    html: string;
    metadata: Record<string, string>;
  },
) {
  try {
    const response = await deps.emailDeliveryService.send(options);
    if (!response.accepted) {
      console.error("Table booking email not accepted", {
        provider: response.provider,
        error: response.error,
        metadata: options.metadata,
      });
    }
  } catch (error) {
    console.error("Table booking email failed", {
      error,
      metadata: options.metadata,
    });
  }
}

async function sendBookingCreatedEmails(
  deps: TableBookingPluginServiceDeps,
  options: {
    projectTitle: string;
    config: TableBookingPluginConfig;
    reservation: ReservationRow;
    cancelUrl: string;
  },
) {
  const bookingDateTimeLabel = formatDateTimeLabelInTimeZone(
    options.reservation.serviceStartAt,
    options.config.timezone,
  );

  const [guestEmail, staffEmail] = await Promise.all([
    deps.emailTemplates.buildGuestConfirmationEmail({
      projectTitle: options.projectTitle,
      guestName: options.reservation.guestName,
      partySize: options.reservation.partySize,
      bookingDateTimeLabel,
      cancelUrl: options.cancelUrl,
    }),
    options.config.notificationRecipientEmails.length > 0
      ? deps.emailTemplates.buildStaffNewBookingEmail({
          projectTitle: options.projectTitle,
          bookingDateTimeLabel,
          partySize: options.reservation.partySize,
          guestName: options.reservation.guestName,
          guestEmail: options.reservation.guestEmail,
          guestPhone: options.reservation.guestPhone,
          notes: options.reservation.notes,
        })
      : Promise.resolve(null),
  ]);

  await Promise.all([
    sendTransactionalEmail(deps, {
      to: [options.reservation.guestEmail],
      subject: guestEmail.subject,
      text: guestEmail.text,
      html: guestEmail.html,
      metadata: {
        plugin: "table_booking",
        flow: "guest_confirmation",
        project: options.reservation.projectSlug,
        organization: options.reservation.organizationId,
      },
    }),
    staffEmail
      ? sendTransactionalEmail(deps, {
          to: options.config.notificationRecipientEmails,
          subject: staffEmail.subject,
          text: staffEmail.text,
          html: staffEmail.html,
          metadata: {
            plugin: "table_booking",
            flow: "staff_new_booking",
            project: options.reservation.projectSlug,
            organization: options.reservation.organizationId,
          },
        })
      : Promise.resolve(),
  ]);
}

async function sendGuestCancellationEmails(
  deps: TableBookingPluginServiceDeps,
  options: {
    projectTitle: string;
    config: TableBookingPluginConfig;
    reservation: ReservationRow;
    cancelledBy: "guest" | "staff";
  },
) {
  const bookingDateTimeLabel = formatDateTimeLabelInTimeZone(
    options.reservation.serviceStartAt,
    options.config.timezone,
  );

  const [guestEmail, staffEmail] = await Promise.all([
    deps.emailTemplates.buildGuestCancellationEmail({
      projectTitle: options.projectTitle,
      guestName: options.reservation.guestName,
      partySize: options.reservation.partySize,
      bookingDateTimeLabel,
    }),
    options.config.notificationRecipientEmails.length > 0
      ? deps.emailTemplates.buildStaffCancellationEmail({
          projectTitle: options.projectTitle,
          bookingDateTimeLabel,
          partySize: options.reservation.partySize,
          guestName: options.reservation.guestName,
          guestEmail: options.reservation.guestEmail,
          guestPhone: options.reservation.guestPhone,
          cancelledBy: options.cancelledBy,
          notes: options.reservation.notes,
        })
      : Promise.resolve(null),
  ]);

  await Promise.all([
    sendTransactionalEmail(deps, {
      to: [options.reservation.guestEmail],
      subject: guestEmail.subject,
      text: guestEmail.text,
      html: guestEmail.html,
      metadata: {
        plugin: "table_booking",
        flow: "guest_cancellation",
        project: options.reservation.projectSlug,
        organization: options.reservation.organizationId,
      },
    }),
    staffEmail
      ? sendTransactionalEmail(deps, {
          to: options.config.notificationRecipientEmails,
          subject: staffEmail.subject,
          text: staffEmail.text,
          html: staffEmail.html,
          metadata: {
            plugin: "table_booking",
            flow: "staff_cancellation",
            project: options.reservation.projectSlug,
            organization: options.reservation.organizationId,
          },
        })
      : Promise.resolve(),
  ]);
}

export function createTableBookingPluginService(
  deps: TableBookingPluginServiceDeps,
) {
  const {
    db,
    tables,
    pluginEntitlementService,
    projectPluginInstanceService,
    getPublicPluginApiBaseUrl,
    inferSourceHosts,
    hostUtils,
  } = deps;
  const {
    tableBookingReservation,
    tableBookingActionToken,
    projectPluginInstance,
  } = tables;

  async function resolvePublicEndpoints() {
    const baseUrl = await getPublicPluginApiBaseUrl();
    return {
      availabilityEndpoint: getTableBookingAvailabilityEndpoint(baseUrl),
      bookEndpoint: getTableBookingBookEndpoint(baseUrl),
      cancelEndpoint: getTableBookingCancelEndpoint(baseUrl),
    };
  }

  async function loadPluginInstanceByToken(token: string) {
    return db.query.projectPluginInstance.findFirst({
      where: and(
        eq(projectPluginInstance.publicToken, token),
        eq(projectPluginInstance.pluginId, "table_booking"),
        eq(projectPluginInstance.status, "enabled"),
      ),
    });
  }

  async function findReservationById(options: {
    organizationId: string;
    projectSlug: string;
    bookingId: string;
  }): Promise<ReservationRow | null> {
    return db.query.tableBookingReservation?.findFirst?.({
      where: and(
        eq(tableBookingReservation.id, options.bookingId),
        eq(tableBookingReservation.organizationId, options.organizationId),
        eq(tableBookingReservation.projectSlug, options.projectSlug),
      ),
    });
  }

  async function findReservationByGuestToken(token: string) {
    const tokenHash = hashToken(token);
    const rows = await db
      .select({
        tokenId: tableBookingActionToken.id,
        tokenExpiresAt: tableBookingActionToken.expiresAt,
        tokenUsedAt: tableBookingActionToken.usedAt,
        reservation: tableBookingReservation,
      })
      .from(tableBookingActionToken)
      .innerJoin(
        tableBookingReservation,
        eq(tableBookingActionToken.reservationId, tableBookingReservation.id),
      )
      .where(
        and(
          eq(tableBookingActionToken.kind, "guest_cancel"),
          eq(tableBookingActionToken.tokenHash, tokenHash),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      tokenId: row.tokenId,
      tokenExpiresAt: row.tokenExpiresAt as Date,
      tokenUsedAt: row.tokenUsedAt as Date | null,
      reservation: row.reservation as ReservationRow,
    };
  }

  async function getSummaryCounts(options: {
    organizationId: string;
    projectSlug: string;
    config: TableBookingPluginConfig;
    rangeDays: 7 | 30;
  }): Promise<TableBookingSummaryPayload["counts"] & TableBookingSummaryPayload["recent"]> {
    const now = new Date();
    const today = formatDateInTimeZone(now, options.config.timezone);
    const startedAt = new Date(now.getTime() - options.rangeDays * 24 * 60 * 60 * 1000);

    const rows = (await db.query.tableBookingReservation?.findMany?.({
      where: and(
        eq(tableBookingReservation.organizationId, options.organizationId),
        eq(tableBookingReservation.projectSlug, options.projectSlug),
      ),
      orderBy: [desc(tableBookingReservation.serviceStartAt)],
    })) as ReservationRow[] | undefined;
    const reservations = rows ?? [];

    const counts = {
      bookingsToday: 0,
      coversToday: 0,
      upcomingBookings: 0,
      upcomingCovers: 0,
      cancelled: 0,
      noShow: 0,
      completed: 0,
      booked: 0,
    };

    for (const reservation of reservations) {
      const serviceStartAt = coerceDateValue(reservation.serviceStartAt);
      const cancelledAt = coerceDateValue(reservation.cancelledAt);
      const noShowAt = coerceDateValue(reservation.noShowAt);
      const completedAt = coerceDateValue(reservation.completedAt);
      const createdAt = coerceDateValue(reservation.createdAt);

      if (reservation.status === "confirmed") {
        if (reservation.serviceDate === today) {
          counts.bookingsToday += 1;
          counts.coversToday += reservation.partySize;
        }
        if (serviceStartAt && serviceStartAt >= now) {
          counts.upcomingBookings += 1;
          counts.upcomingCovers += reservation.partySize;
        }
      }

      if (
        (reservation.status === "cancelled_by_guest" ||
          reservation.status === "cancelled_by_staff") &&
        cancelledAt &&
        cancelledAt >= startedAt
      ) {
        counts.cancelled += 1;
      }
      if (reservation.status === "no_show" && noShowAt && noShowAt >= startedAt) {
        counts.noShow += 1;
      }
      if (
        reservation.status === "completed" &&
        completedAt &&
        completedAt >= startedAt
      ) {
        counts.completed += 1;
      }
      if (createdAt && createdAt >= startedAt) {
        counts.booked += 1;
      }
    }

    return counts;
  }

  async function buildInfoPayload(options: {
    organizationId: string;
    projectSlug: string;
    existing: TableBookingPluginInstanceRow | null;
  }) {
    const [entitlement, inferredSourceHosts, endpoints, projectTitle] = await Promise.all([
      pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      }),
      inferSourceHosts({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
      }),
      resolvePublicEndpoints(),
      readProjectTitle(deps, options),
    ]);

    const config = options.existing
      ? normalizeTableBookingConfig(options.existing.configJson)
      : null;
    const effectiveSourceHosts = config
      ? resolveEffectiveSourceHosts(config, inferredSourceHosts, deps)
      : normalizeHostAllowlist(inferredSourceHosts, deps);
    const snippets =
      options.existing && config
        ? getTableBookingSnippets(
            options.existing.publicToken,
            {
              availabilityEndpoint: endpoints.availabilityEndpoint,
              bookEndpoint: endpoints.bookEndpoint,
            },
            config,
          )
        : null;

    const counts = config
      ? await getSummaryCounts({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          config,
          rangeDays: 7,
        })
      : {
          bookingsToday: 0,
          coversToday: 0,
          upcomingBookings: 0,
          upcomingCovers: 0,
          cancelled: 0,
          noShow: 0,
          completed: 0,
          booked: 0,
        };

    const instructions = [
      "Use the generated HTML or Astro snippet instead of rebuilding the widget manually.",
      "Configure at least one notification recipient email before launch.",
      `Guest confirmation emails use ${projectTitle} as the visible restaurant/project name.`,
    ];

    return {
      entitled: entitlement.state === "enabled",
      entitlementState: entitlement.state,
      enabled: options.existing?.status === "enabled",
      instanceId: options.existing?.id ?? null,
      status: options.existing?.status ?? null,
      publicToken: options.existing?.publicToken ?? null,
      config,
      snippets,
      usage: {
        availabilityEndpoint: endpoints.availabilityEndpoint,
        bookEndpoint: endpoints.bookEndpoint,
        cancelEndpoint: endpoints.cancelEndpoint,
        expectedFields: ["date", "partySize", "time", "name", "email", "phone"],
        optionalFields: ["notes", "_redirect", "_honeypot"],
        inferredAutoSourceHosts: effectiveSourceHosts,
      },
      details: {
        counts: {
          bookingsToday: counts.bookingsToday,
          upcomingBookings: counts.upcomingBookings,
          upcomingCovers: counts.upcomingCovers,
        },
        notificationRecipients: config?.notificationRecipientEmails ?? [],
      },
      instructions,
    };
  }

  async function buildAvailableSlots(options: {
    pluginInstance: TableBookingPluginInstanceRow;
    config: TableBookingPluginConfig;
    date: string;
    partySize: number;
    now: Date;
  }) {
    validateAvailabilityInput({
      date: options.date,
      partySize: options.partySize,
      config: options.config,
    });

    const candidates = listCandidateSlots({
      config: options.config,
      date: options.date,
      partySize: options.partySize,
    });
    if (candidates.length === 0) return [];

    const reservations = await listReservationsForDate(
      db,
      tables,
      options.pluginInstance.id,
      options.date,
    );

    return candidates
      .filter((candidate) => {
        try {
          validateBookingWindow({
            config: options.config,
            date: options.date,
            startAt: candidate.startAt,
            now: options.now,
          });
        } catch {
          return false;
        }

        const overlappingCovers = reservations
          .filter((reservation) => reservation.status === "confirmed")
          .filter((reservation) =>
            overlaps(
              reservation.serviceStartAt,
              reservation.serviceEndAt,
              candidate.startAt,
              candidate.endAt,
            ),
          )
          .reduce((sum, reservation) => sum + reservation.partySize, 0);

        return overlappingCovers + options.partySize <= candidate.maxConcurrentCovers;
      })
      .map((candidate) => ({
        time: candidate.time,
        label: candidate.time,
      }));
  }

  async function enforceMonthlyLimit(options: {
    pluginInstance: TableBookingPluginInstanceRow;
    entitlement: Awaited<
      ReturnType<TableBookingPluginServiceDeps["pluginEntitlementService"]["resolveEffectiveEntitlement"]>
    >;
  }) {
    if (
      !options.entitlement.hardStop ||
      typeof options.entitlement.monthlyEventLimit !== "number" ||
      options.entitlement.monthlyEventLimit < 0
    ) {
      return;
    }

    const currentMonthRows = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(tableBookingReservation)
      .where(
        and(
          eq(tableBookingReservation.organizationId, options.pluginInstance.organizationId),
          options.entitlement.scope === "organization" ||
          options.entitlement.scope === "instance"
            ? undefined
            : eq(tableBookingReservation.projectSlug, options.pluginInstance.projectSlug),
          gte(tableBookingReservation.createdAt, startOfUtcMonth()),
        ),
      );

    if (toCount(currentMonthRows[0]?.count) >= options.entitlement.monthlyEventLimit) {
      throw new TableBookingQuotaExceededError();
    }
  }

  return {
    async ensureTableBookingPlugin(options: {
      organizationId: string;
      projectSlug: string;
    }) {
      const ensured = await projectPluginInstanceService.ensurePluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      const config = normalizeTableBookingConfig(ensured.row.configJson);
      const endpoints = await resolvePublicEndpoints();

      return {
        pluginId: "table_booking" as const,
        instanceId: ensured.row.id,
        status: ensured.row.status,
        created: ensured.created,
        publicToken: ensured.row.publicToken,
        config,
        snippets: getTableBookingSnippets(
          ensured.row.publicToken,
          {
            availabilityEndpoint: endpoints.availabilityEndpoint,
            bookEndpoint: endpoints.bookEndpoint,
          },
          config,
        ),
      };
    },

    async getTableBookingInfo(options: {
      organizationId: string;
      projectSlug: string;
    }) {
      const existing = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      return buildInfoPayload({ ...options, existing });
    },

    async updateTableBookingConfig(options: {
      organizationId: string;
      projectSlug: string;
      config: Record<string, unknown>;
    }) {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance) {
        throw new TableBookingPluginNotEnabledError();
      }

      const parsedConfig = tableBookingPluginConfigSchema.parse(options.config);
      await projectPluginInstanceService.updatePluginInstance({
        instanceId: pluginInstance.id,
        configJson: parsedConfig,
        updatedAt: new Date(),
      });

      return this.getTableBookingInfo(options);
    },

    async getTableBookingSummary(options: {
      organizationId: string;
      projectSlug: string;
      rangeDays: 7 | 30;
    }): Promise<TableBookingSummaryPayload> {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance || pluginInstance.status !== "enabled") {
        return {
          pluginId: "table_booking",
          enabled: false,
          rangeDays: options.rangeDays,
          counts: {
            bookingsToday: 0,
            coversToday: 0,
            upcomingBookings: 0,
            upcomingCovers: 0,
            cancelled: 0,
            noShow: 0,
            completed: 0,
          },
          recent: {
            booked: 0,
            cancelled: 0,
            noShow: 0,
            completed: 0,
          },
        };
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const counts = await getSummaryCounts({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        config,
        rangeDays: options.rangeDays,
      });

      return {
        pluginId: "table_booking",
        enabled: true,
        rangeDays: options.rangeDays,
        counts: {
          bookingsToday: counts.bookingsToday,
          coversToday: counts.coversToday,
          upcomingBookings: counts.upcomingBookings,
          upcomingCovers: counts.upcomingCovers,
          cancelled: counts.cancelled,
          noShow: counts.noShow,
          completed: counts.completed,
        },
        recent: {
          booked: counts.booked,
          cancelled: counts.cancelled,
          noShow: counts.noShow,
          completed: counts.completed,
        },
      };
    },

    async listBookings(options: {
      organizationId: string;
      projectSlug: string;
      status: "all" | "confirmed" | "cancelled_by_guest" | "cancelled_by_staff" | "no_show" | "completed";
      search?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }): Promise<TableBookingBookingsPayload> {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance || pluginInstance.status !== "enabled") {
        return {
          pluginId: "table_booking",
          enabled: false,
          status: options.status,
          search: options.search?.trim() || "",
          startDate: options.startDate ?? null,
          endDate: options.endDate ?? null,
          total: 0,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
          rows: [],
        };
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const search = options.search?.trim() || "";
      const limit = Math.max(1, Math.min(200, options.limit ?? 50));
      const offset = Math.max(0, options.offset ?? 0);
      const searchPattern = `%${search.replace(/\s+/g, "%")}%`;
      const conditions = and(
        eq(tableBookingReservation.organizationId, options.organizationId),
        eq(tableBookingReservation.projectSlug, options.projectSlug),
        options.status === "all"
          ? undefined
          : eq(tableBookingReservation.status, options.status),
        options.startDate
          ? gte(tableBookingReservation.serviceDate, options.startDate)
          : undefined,
        options.endDate
          ? lte(tableBookingReservation.serviceDate, options.endDate)
          : undefined,
        search
          ? or(
              ilike(tableBookingReservation.guestName, searchPattern),
              ilike(tableBookingReservation.guestEmail, searchPattern),
              ilike(tableBookingReservation.guestPhone, searchPattern),
            )
          : undefined,
      );

      const [countRows, rows] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(tableBookingReservation)
          .where(conditions),
        db.query.tableBookingReservation?.findMany?.({
          where: conditions,
          orderBy: [
            asc(tableBookingReservation.serviceDate),
            asc(tableBookingReservation.serviceStartAt),
          ],
          limit,
          offset,
        }) as Promise<ReservationRow[]>,
      ]);

      const now = new Date();

      return {
        pluginId: "table_booking",
        enabled: true,
        status: options.status,
        search,
        startDate: options.startDate ?? null,
        endDate: options.endDate ?? null,
        total: toCount(countRows[0]?.count),
        limit,
        offset,
        rows: (rows ?? []).map((row) => toBookingRecord(row, config, now)),
      };
    },

    async getAgenda(options: {
      organizationId: string;
      projectSlug: string;
      rangeDays: number;
    }): Promise<TableBookingAgendaPayload> {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance || pluginInstance.status !== "enabled") {
        return {
          pluginId: "table_booking",
          enabled: false,
          rangeDays: options.rangeDays,
          groups: [],
        };
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const now = new Date();
      const upperBound = endOfRangeFromDate(now, options.rangeDays);
      const rows = ((await db.query.tableBookingReservation?.findMany?.({
        where: and(
          eq(tableBookingReservation.organizationId, options.organizationId),
          eq(tableBookingReservation.projectSlug, options.projectSlug),
          eq(tableBookingReservation.status, "confirmed"),
          gte(tableBookingReservation.serviceStartAt, now),
          lte(tableBookingReservation.serviceStartAt, upperBound),
        ),
        orderBy: [
          asc(tableBookingReservation.serviceDate),
          asc(tableBookingReservation.serviceStartAt),
        ],
      })) ?? []) as ReservationRow[];

      const groups = new Map<string, TableBookingRecord[]>();
      for (const reservation of rows) {
        const current = groups.get(reservation.serviceDate) ?? [];
        current.push(toBookingRecord(reservation, config, now));
        groups.set(reservation.serviceDate, current);
      }

      return {
        pluginId: "table_booking",
        enabled: true,
        rangeDays: options.rangeDays,
        groups: Array.from(groups.entries()).map(([serviceDate, bookings]) => ({
          serviceDate,
          bookings,
        })),
      };
    },

    async cancelBookingById(options: {
      organizationId: string;
      projectSlug: string;
      bookingId: string;
    }) {
      const reservation = await findReservationById(options);
      if (!reservation) {
        throw new TableBookingReservationNotFoundError(options.bookingId);
      }
      if (
        reservation.status === "cancelled_by_guest" ||
        reservation.status === "cancelled_by_staff"
      ) {
        return {
          bookingId: reservation.id,
          status: "already_cancelled" as const,
        };
      }

      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      const config = normalizeTableBookingConfig(pluginInstance?.configJson ?? {});
      const [updated] = await db
        .update(tableBookingReservation)
        .set({
          status: "cancelled_by_staff",
          cancelledAt: new Date(),
          cancelledBy: "staff",
          updatedAt: new Date(),
        })
        .where(eq(tableBookingReservation.id, reservation.id))
        .returning();

      const projectTitle = await readProjectTitle(deps, options);
      if (updated) {
        await sendGuestCancellationEmails(deps, {
          projectTitle,
          config,
          reservation: updated as ReservationRow,
          cancelledBy: "staff",
        });
      }

      return {
        bookingId: reservation.id,
        status: "cancelled_by_staff" as const,
      };
    },

    async markBookingNoShow(options: {
      organizationId: string;
      projectSlug: string;
      bookingId: string;
    }) {
      const reservation = await findReservationById(options);
      if (!reservation) {
        throw new TableBookingReservationNotFoundError(options.bookingId);
      }

      await db
        .update(tableBookingReservation)
        .set({
          status: "no_show",
          noShowAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tableBookingReservation.id, reservation.id));

      return {
        bookingId: reservation.id,
        status: "no_show" as const,
      };
    },

    async markBookingCompleted(options: {
      organizationId: string;
      projectSlug: string;
      bookingId: string;
    }) {
      const reservation = await findReservationById(options);
      if (!reservation) {
        throw new TableBookingReservationNotFoundError(options.bookingId);
      }

      await db
        .update(tableBookingReservation)
        .set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tableBookingReservation.id, reservation.id));

      return {
        bookingId: reservation.id,
        status: "completed" as const,
      };
    },

    async listAvailability(options: TableBookingAvailabilityInput) {
      const pluginInstance = await loadPluginInstanceByToken(options.token);
      if (!pluginInstance) {
        throw new TableBookingPluginNotEnabledError();
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const inferredSourceHosts = await inferSourceHosts({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
      });
      const effectiveSourceHosts = resolveEffectiveSourceHosts(
        config,
        inferredSourceHosts,
        deps,
      );
      if (
        effectiveSourceHosts.length > 0 &&
        !hostUtils.isHostAllowed(options.sourceHost, effectiveSourceHosts)
      ) {
        throw new TableBookingSourceHostError();
      }

      return {
        slots: await buildAvailableSlots({
          pluginInstance,
          config,
          date: options.date,
          partySize: options.partySize,
          now: new Date(),
        }),
      };
    },

    async createReservation(options: TableBookingReservationMutationInput): Promise<{
      redirectTarget: string | null;
      result: TableBookingReservationMutationResult;
    }> {
      const pluginInstance = await loadPluginInstanceByToken(options.token);
      if (!pluginInstance) {
        throw new TableBookingPluginNotEnabledError();
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      validateBookingPayload({ input: options, config });

      const entitlement = await pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        pluginId: "table_booking",
      });
      if (entitlement.state !== "enabled") {
        throw new TableBookingPluginNotEnabledError();
      }

      const inferredSourceHosts = await inferSourceHosts({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
      });
      const effectiveSourceHosts = resolveEffectiveSourceHosts(
        config,
        inferredSourceHosts,
        deps,
      );
      if (
        effectiveSourceHosts.length > 0 &&
        !hostUtils.isHostAllowed(options.sourceHost, effectiveSourceHosts)
      ) {
        throw new TableBookingSourceHostError();
      }

      const redirectHosts = resolveEffectiveRedirectHosts(
        config,
        effectiveSourceHosts,
        deps,
      );
      const successRedirectTarget =
        resolveRedirectTarget(options.redirect, redirectHosts, deps) ??
        resolveDefaultSuccessRedirectTarget({
          rawReferer: options.referer,
          rawOrigin: options.origin,
          allowlist: redirectHosts,
          deps,
        });

      const now = new Date();
      const ipHash = hashClientIp(options.clientIp);
      const recentByToken = await countRecentRequests({
        deps,
        pluginInstanceId: pluginInstance.id,
        since: new Date(now.getTime() - 60_000),
        ipHash: null,
      });
      if (recentByToken.tokenCount >= TOKEN_RATE_LIMIT_PER_MINUTE) {
        throw new TableBookingValidationError("Too many booking attempts. Please try again later.");
      }

      const recentByIp = ipHash
        ? await countRecentRequests({
            deps,
            pluginInstanceId: pluginInstance.id,
            since: new Date(now.getTime() - 60 * 60 * 1000),
            ipHash,
          })
        : { tokenCount: 0, ipCount: 0 };
      if (recentByIp.ipCount >= IP_RATE_LIMIT_PER_HOUR) {
        throw new TableBookingValidationError("Too many booking attempts. Please try again later.");
      }

      await enforceMonthlyLimit({ pluginInstance, entitlement });

      const candidateSlots = await buildAvailableSlots({
        pluginInstance,
        config,
        date: options.date,
        partySize: options.partySize,
        now,
      });
      const selectedSlot = candidateSlots.find((slot) => slot.time === options.time);
      if (!selectedSlot) {
        throw new TableBookingCapacityError();
      }

      const matchingPeriod = resolveServicePeriodsForDate(config, options.date).find(
        (period) =>
          period.startTime <= options.time &&
          period.endTime > options.time &&
          (!period.maxPartySize || options.partySize <= period.maxPartySize),
      );
      if (!matchingPeriod) {
        throw new TableBookingCapacityError();
      }

      const serviceStartAt = zonedDateTimeToUtc(
        options.date,
        options.time,
        config.timezone,
      );
      const durationMinutes = matchingPeriod.durationMinutes ?? config.defaultDurationMinutes;
      const serviceEndAt = new Date(serviceStartAt.getTime() + durationMinutes * 60_000);

      validateBookingWindow({
        config,
        date: options.date,
        startAt: serviceStartAt,
        now,
      });

      const normalizedGuestName = normalizeRequiredText(options.name, 120);
      const normalizedGuestEmail = normalizeRequiredText(options.email, 320);
      const normalizedGuestEmailLower = normalizeEmailAddress(options.email);
      const normalizedGuestPhone = normalizeRequiredText(options.phone, 64);
      const normalizedNotes = normalizeOptionalText(options.notes, 2000);
      const referer = parseRefererParts(options.referer);

      const duplicateSince = new Date(now.getTime() - DUPLICATE_WINDOW_MS);
      const projectTitle = await readProjectTitle(deps, {
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
      });
      const endpoints = await resolvePublicEndpoints();

      const result = await db.transaction(async (tx: any) => {
        const existingRows = await tx
          .select()
          .from(tableBookingReservation)
          .where(
            and(
              eq(tableBookingReservation.pluginInstanceId, pluginInstance.id),
              eq(tableBookingReservation.serviceStartAt, serviceStartAt),
              eq(tableBookingReservation.guestEmailNormalized, normalizedGuestEmailLower),
              gte(tableBookingReservation.createdAt, duplicateSince),
            ),
          )
          .limit(1);
        const existing = existingRows[0] as ReservationRow | undefined;
        if (
          existing &&
          (existing.status === "confirmed" ||
            existing.status === "completed" ||
            existing.status === "no_show")
        ) {
          return {
            reservation: existing,
            alreadyConfirmed: true,
            rawCancelToken: null,
          };
        }

        const sameDayReservations = await listReservationsForDate(
          tx,
          tables,
          pluginInstance.id,
          options.date,
        );
        const overlappingCovers = sameDayReservations
          .filter((reservation) => reservation.status === "confirmed")
          .filter((reservation) =>
            overlaps(
              reservation.serviceStartAt,
              reservation.serviceEndAt,
              serviceStartAt,
              serviceEndAt,
            ),
          )
          .reduce((sum, reservation) => sum + reservation.partySize, 0);
        if (overlappingCovers + options.partySize > matchingPeriod.maxConcurrentCovers) {
          throw new TableBookingCapacityError();
        }

        const reservationId = randomUUID();
        const [inserted] = await tx
          .insert(tableBookingReservation)
          .values({
            id: reservationId,
            organizationId: pluginInstance.organizationId,
            projectSlug: pluginInstance.projectSlug,
            pluginInstanceId: pluginInstance.id,
            status: "confirmed",
            serviceDate: options.date,
            serviceStartAt,
            serviceEndAt,
            partySize: options.partySize,
            guestName: normalizedGuestName,
            guestEmail: normalizedGuestEmail,
            guestEmailNormalized: normalizedGuestEmailLower,
            guestPhone: normalizedGuestPhone,
            notes: normalizedNotes,
            sourceHost: options.sourceHost,
            sourcePath: referer.path,
            referrerHost: referer.host,
            utmSource: referer.utmSource,
            utmMedium: referer.utmMedium,
            utmCampaign: referer.utmCampaign,
            lastIpHash: ipHash,
            confirmedAt: now,
          })
          .returning();

        const rawCancelToken = createRawToken();
        await tx.insert(tableBookingActionToken).values({
          id: randomUUID(),
          reservationId,
          organizationId: pluginInstance.organizationId,
          projectSlug: pluginInstance.projectSlug,
          kind: "guest_cancel",
          tokenHash: hashToken(rawCancelToken),
          expiresAt: new Date(
            Math.max(
              Date.now() + CANCEL_TOKEN_TTL_MS,
              serviceEndAt.getTime() + 24 * 60 * 60 * 1000,
            ),
          ),
          usedAt: null,
        });

        return {
          reservation: inserted as ReservationRow,
          alreadyConfirmed: false,
          rawCancelToken,
        };
      });

      if (!result.alreadyConfirmed && result.rawCancelToken) {
        const cancelUrl = withRedirectParam(
          `${endpoints.cancelEndpoint}?token=${encodeURIComponent(result.rawCancelToken)}`,
          successRedirectTarget,
        );
        await sendBookingCreatedEmails(deps, {
          projectTitle,
          config,
          reservation: result.reservation,
          cancelUrl,
        });
      }

      return {
        redirectTarget: successRedirectTarget,
        result: {
          bookingId: result.reservation.id,
          status: result.alreadyConfirmed ? "already_confirmed" : "confirmed",
          serviceDate: result.reservation.serviceDate,
          time: formatTimeInTimeZone(result.reservation.serviceStartAt, config.timezone),
          partySize: result.reservation.partySize,
        },
      };
    },

    async getCancelPreview(options: { token: string }): Promise<TableBookingCancelPreviewResult> {
      const row = await findReservationByGuestToken(options.token);
      if (!row) return { status: "invalid" };
      if (row.tokenUsedAt) {
        return {
          status: "already_cancelled",
          reservation: {
            guestName: row.reservation.guestName,
            serviceDate: row.reservation.serviceDate,
            bookingDateTimeLabel: toDateTimeDisplayString(
              row.reservation.serviceStartAt,
              getServiceDateFallback(row.reservation.serviceDate),
            ),
            partySize: row.reservation.partySize,
          },
        };
      }
      if (row.tokenExpiresAt < new Date()) return { status: "expired" };

      const config = normalizeTableBookingConfig(
        (
          await projectPluginInstanceService.getPluginInstance({
            organizationId: row.reservation.organizationId,
            projectSlug: row.reservation.projectSlug,
            pluginId: "table_booking",
          })
        )?.configJson ?? {},
      );
      const bookingDateTimeLabel = formatDateTimeLabelInTimeZone(
        row.reservation.serviceStartAt,
        config.timezone,
      );

      if (
        row.reservation.status === "cancelled_by_guest" ||
        row.reservation.status === "cancelled_by_staff"
      ) {
        return {
          status: "already_cancelled",
          reservation: {
            guestName: row.reservation.guestName,
            serviceDate: row.reservation.serviceDate,
            bookingDateTimeLabel,
            partySize: row.reservation.partySize,
          },
        };
      }

      if (!canGuestCancelReservation(row.reservation, config, new Date())) {
        return {
          status: "cutoff_passed",
          reservation: {
            guestName: row.reservation.guestName,
            serviceDate: row.reservation.serviceDate,
            bookingDateTimeLabel,
            partySize: row.reservation.partySize,
          },
        };
      }

      return {
        status: "confirm",
        reservation: {
          guestName: row.reservation.guestName,
          serviceDate: row.reservation.serviceDate,
          bookingDateTimeLabel,
          partySize: row.reservation.partySize,
        },
      };
    },

    async cancelByToken(options: {
      token: string;
      redirect: string | null;
    }): Promise<TableBookingCancelByTokenResult> {
      const row = await findReservationByGuestToken(options.token);
      if (!row) return { status: "invalid" };
      if (row.tokenUsedAt) return { status: "already_cancelled" };
      if (row.tokenExpiresAt < new Date()) return { status: "expired" };

      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: row.reservation.organizationId,
        projectSlug: row.reservation.projectSlug,
        pluginId: "table_booking",
      });
      const config = normalizeTableBookingConfig(pluginInstance?.configJson ?? {});
      if (!canGuestCancelReservation(row.reservation, config, new Date())) {
        return { status: "cutoff_passed" };
      }

      const [updated] = await db
        .update(tableBookingReservation)
        .set({
          status: "cancelled_by_guest",
          cancelledAt: new Date(),
          cancelledBy: "guest",
          updatedAt: new Date(),
        })
        .where(eq(tableBookingReservation.id, row.reservation.id))
        .returning();

      await db
        .update(tableBookingActionToken)
        .set({
          usedAt: new Date(),
        })
        .where(eq(tableBookingActionToken.id, row.tokenId));

      const projectTitle = await readProjectTitle(deps, {
        organizationId: row.reservation.organizationId,
        projectSlug: row.reservation.projectSlug,
      });
      if (updated) {
        await sendGuestCancellationEmails(deps, {
          projectTitle,
          config,
          reservation: updated as ReservationRow,
          cancelledBy: "guest",
        });
      }

      const inferredSourceHosts = await inferSourceHosts({
        organizationId: row.reservation.organizationId,
        projectSlug: row.reservation.projectSlug,
      });
      const redirectTarget = resolveRedirectTarget(
        options.redirect,
        resolveEffectiveRedirectHosts(
          config,
          resolveEffectiveSourceHosts(config, inferredSourceHosts, deps),
          deps,
        ),
        deps,
      );

      return {
        status: "cancelled",
        redirectTarget,
      };
    },
  };
}
