import {
  CAPACITY_MODE_LABELS,
  SOURCE_CHANNEL_LABELS,
  STATUS_LABELS,
  WEEKDAY_ORDER,
} from "./constants";
import type {
  TableBookingCapacityMode,
  DailyBookingSummary,
  TableBookingDateOverride,
  TableBookingPluginConfig,
  TableBookingRecord,
  TableBookingSchedulePeriod,
  TableBookingSourceChannel,
  TableBookingStatus,
  TableBookingWeeklyScheduleEntry,
} from "./types";
import type { TableBookingReservationErrors } from "./useReservationEditor";

export function parseListInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split("\n")
        .flatMap((line) => line.split(","))
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function formatListInput(values: string[]): string {
  return values.join("\n");
}

export function formatDateTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatTimeInputValue(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "17:00";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatLongDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

export function formatMonthLabel(value: string, timeZone: string): string {
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number.parseInt(yearRaw || "0", 10);
  const month = Number.parseInt(monthRaw || "1", 10);
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 15, 12, 0, 0)));
}

export function getTodayIsoDate(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function getMonthStartDate(monthKey: string): string {
  return `${monthKey}-01`;
}

export function getMonthRange(monthKey: string): {
  startDate: string;
  endDate: string;
} {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number.parseInt(yearRaw || "0", 10);
  const month = Number.parseInt(monthRaw || "1", 10);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    startDate: `${monthKey}-01`,
    endDate: `${monthKey}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function addMonthsToMonthKey(monthKey: string, offset: number): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number.parseInt(yearRaw || "0", 10);
  const month = Number.parseInt(monthRaw || "1", 10);
  const next = new Date(Date.UTC(year, month - 1 + offset, 1));

  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getWeekdayFromIsoDate(value: string): number {
  return new Date(`${value}T12:00:00.000Z`).getUTCDay();
}

export function buildMonthGrid(monthKey: string): Array<{
  date: string;
  inMonth: boolean;
}> {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number.parseInt(yearRaw || "0", 10);
  const month = Number.parseInt(monthRaw || "1", 10);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const gridStart = new Date(Date.UTC(year, month - 1, 1 - mondayOffset));

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    return {
      date: key,
      inMonth: key.startsWith(monthKey),
    };
  });
}

export function sortPeriods(
  periods: TableBookingSchedulePeriod[],
): TableBookingSchedulePeriod[] {
  return [...periods]
    .map((period) => ({ ...period }))
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
}

export function normalizeWeeklySchedule(
  entries: TableBookingWeeklyScheduleEntry[],
): TableBookingWeeklyScheduleEntry[] {
  return [...entries]
    .map((entry) => ({
      ...entry,
      periods: sortPeriods(entry.periods ?? []),
    }))
    .sort(
      (left, right) =>
        WEEKDAY_ORDER.indexOf(left.dayOfWeek as (typeof WEEKDAY_ORDER)[number]) -
        WEEKDAY_ORDER.indexOf(right.dayOfWeek as (typeof WEEKDAY_ORDER)[number]),
    );
}

export function normalizeDateOverrides(
  overrides: TableBookingDateOverride[],
): TableBookingDateOverride[] {
  return [...overrides]
    .map((override) => ({
      ...override,
      periods: sortPeriods(override.periods ?? []),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function serializeComparableConfig(
  config: TableBookingPluginConfig,
): string {
  return JSON.stringify({
    ...config,
    sourceHosts: [...config.sourceHosts],
    redirectHostAllowlist: [...config.redirectHostAllowlist],
    notificationRecipientEmails: [...config.notificationRecipientEmails],
    weeklySchedule: normalizeWeeklySchedule(config.weeklySchedule ?? []),
    dateOverrides: normalizeDateOverrides(config.dateOverrides ?? []),
  });
}

export function createDefaultPeriod(): TableBookingSchedulePeriod {
  return {
    startTime: "17:00",
    endTime: "21:00",
    slotIntervalMinutes: 30,
    maxConcurrentCovers: 28,
  };
}

export function getWeeklyScheduleEntry(
  weeklySchedule: TableBookingWeeklyScheduleEntry[],
  dayOfWeek: number,
): TableBookingWeeklyScheduleEntry {
  return (
    weeklySchedule.find((entry) => entry.dayOfWeek === dayOfWeek) ?? {
      dayOfWeek,
      periods: [],
    }
  );
}

export function getDateOverride(
  dateOverrides: TableBookingDateOverride[],
  date: string,
): TableBookingDateOverride | null {
  return dateOverrides.find((override) => override.date === date) ?? null;
}

export function resolveScheduleForDate(options: {
  weeklySchedule: TableBookingWeeklyScheduleEntry[];
  dateOverrides: TableBookingDateOverride[];
  date: string;
}): {
  periods: TableBookingSchedulePeriod[];
  isClosed: boolean;
  hasOverride: boolean;
  dayOfWeek: number;
} {
  const dayOfWeek = getWeekdayFromIsoDate(options.date);
  const override = getDateOverride(options.dateOverrides, options.date);

  if (override) {
    const periods = sortPeriods(override.periods ?? []);
    return {
      periods,
      isClosed: override.closed || periods.length === 0,
      hasOverride: true,
      dayOfWeek,
    };
  }

  const entry = getWeeklyScheduleEntry(options.weeklySchedule, dayOfWeek);
  const periods = sortPeriods(entry.periods);
  return {
    periods,
    isClosed: periods.length === 0,
    hasOverride: false,
    dayOfWeek,
  };
}

export function setWeeklySchedulePeriods(options: {
  weeklySchedule: TableBookingWeeklyScheduleEntry[];
  dayOfWeek: number;
  periods: TableBookingSchedulePeriod[];
}): TableBookingWeeklyScheduleEntry[] {
  const next = options.weeklySchedule.filter(
    (entry) => entry.dayOfWeek !== options.dayOfWeek,
  );

  if (options.periods.length > 0) {
    next.push({
      dayOfWeek: options.dayOfWeek,
      periods: sortPeriods(options.periods),
    });
  }

  return normalizeWeeklySchedule(next);
}

export function upsertDateOverride(options: {
  dateOverrides: TableBookingDateOverride[];
  override: TableBookingDateOverride;
}): TableBookingDateOverride[] {
  const next = options.dateOverrides.filter(
    (entry) => entry.date !== options.override.date,
  );
  next.push({
    ...options.override,
    periods: sortPeriods(options.override.periods ?? []),
  });
  return normalizeDateOverrides(next);
}

export function removeDateOverrideByDate(
  dateOverrides: TableBookingDateOverride[],
  date: string,
): TableBookingDateOverride[] {
  return normalizeDateOverrides(
    dateOverrides.filter((override) => override.date !== date),
  );
}

export function buildDailyBookingSummary(
  rows: TableBookingRecord[],
): Map<string, DailyBookingSummary> {
  const summaries = new Map<string, DailyBookingSummary>();

  for (const row of rows) {
    const current = summaries.get(row.serviceDate) ?? {
      count: 0,
      covers: 0,
      confirmed: 0,
      cancelled: 0,
      noShow: 0,
      completed: 0,
    };

    current.count += 1;
    current.covers += row.partySize;

    if (row.status === "confirmed") current.confirmed += 1;
    if (
      row.status === "cancelled_by_guest" ||
      row.status === "cancelled_by_staff"
    ) {
      current.cancelled += 1;
    }
    if (row.status === "no_show") current.noShow += 1;
    if (row.status === "completed") current.completed += 1;

    summaries.set(row.serviceDate, current);
  }

  return summaries;
}

export function formatScheduleSummary(
  period: TableBookingSchedulePeriod,
  defaultDurationMinutes: number,
): string {
  const durationMinutes = period.durationMinutes ?? defaultDurationMinutes;
  const parts = [
    `${period.startTime} - ${period.endTime}`,
    `every ${period.slotIntervalMinutes} min`,
    `up to ${period.maxConcurrentCovers} covers`,
    `${durationMinutes} min stay`,
  ];

  if (period.maxPartySize) {
    parts.push(`party cap ${period.maxPartySize}`);
  }

  return parts.join(" · ");
}

export function formatDraftError(issue: {
  path: PropertyKey[];
  message: string;
}): string {
  if (issue.path.length === 0) return issue.message;
  return `${issue.path.map((part) => String(part)).join(".")}: ${issue.message}`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateReservationDraft(input: {
  date: string;
  time: string;
  partySize: string;
  name: string;
  email: string;
  phone: string;
  sendGuestNotification: boolean;
}): {
  errors: TableBookingReservationErrors;
  partySize: number;
} {
  const errors: TableBookingReservationErrors = {};
  const date = input.date.trim();
  const time = input.time.trim();
  const partySize = Number.parseInt(input.partySize || "0", 10);
  const name = input.name.trim();
  const email = input.email.trim();
  const phone = input.phone.trim();

  if (!date) {
    errors.date = "Choose a reservation date.";
  }
  if (!time) {
    errors.time = "Choose a reservation time.";
  }
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 50) {
    errors.partySize = "Party size must be between 1 and 50.";
  }
  if (!name) {
    errors.name = "Guest name is required.";
  }
  if (!email && !phone) {
    errors.contact = "Add at least one contact method.";
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (phone && (phone.length < 3 || phone.length > 64)) {
    errors.phone = "Enter a valid phone number.";
  }
  if (input.sendGuestNotification && !email) {
    errors.email = "Guest confirmation email requires an email address.";
  }

  return { errors, partySize };
}

export function formatStatusLabel(status: TableBookingStatus): string {
  return STATUS_LABELS[status];
}

export function formatSourceChannelLabel(
  sourceChannel: TableBookingSourceChannel,
): string {
  return SOURCE_CHANNEL_LABELS[sourceChannel];
}

export function formatCapacityModeLabel(mode: TableBookingCapacityMode): string {
  return CAPACITY_MODE_LABELS[mode];
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function getCalendarDayTitle(schedule: {
  periods: TableBookingSchedulePeriod[];
  isClosed: boolean;
}): string {
  if (schedule.isClosed) return "Closed";
  if (schedule.periods.length === 1) {
    return `${schedule.periods[0]!.startTime} - ${schedule.periods[0]!.endTime}`;
  }
  return `${schedule.periods.length} service windows`;
}

export function getCalendarDayCaption(schedule: {
  periods: TableBookingSchedulePeriod[];
  isClosed: boolean;
  hasOverride: boolean;
}): string {
  if (schedule.isClosed) {
    return schedule.hasOverride ? "Date override" : "No service";
  }
  if (schedule.periods.length === 1) {
    return schedule.hasOverride ? "Custom hours" : "Open";
  }
  return schedule.hasOverride ? "Custom hours" : "Multiple windows";
}

export function getBookingStatusBadgeVariant(
  status: TableBookingStatus,
): "success" | "destructive" | "secondary" | "outline" {
  if (status === "confirmed") return "success";
  if (status === "cancelled_by_guest" || status === "cancelled_by_staff") {
    return "destructive";
  }
  if (status === "no_show") return "secondary";
  return "outline";
}

export function getScheduleMaxConcurrentCovers(
  periods: TableBookingSchedulePeriod[],
): number {
  let total = 0;
  for (const period of periods) {
    total += period.maxConcurrentCovers;
  }
  return total;
}

export function getWeekStartDate(date: string): string {
  const current = new Date(`${date}T12:00:00.000Z`);
  const dayOfWeek = current.getUTCDay();
  const mondayOffset = (dayOfWeek + 6) % 7;
  current.setUTCDate(current.getUTCDate() - mondayOffset);
  return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`;
}

export function buildWeekDates(startDate: string): string[] {
  const start = new Date(`${startDate}T12:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  });
}

export function addDaysToIsoDate(date: string, offset: number): string {
  const current = new Date(`${date}T12:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + offset);
  return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`;
}

export function parseTimeToMinutes(value: string): number {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number.parseInt(hoursRaw || "0", 10);
  const minutes = Number.parseInt(minutesRaw || "0", 10);
  return hours * 60 + minutes;
}

export function formatTimeFromMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, total));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function getBookingMinutesInTimezone(
  value: string,
  timeZone: string,
): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number.parseInt(
    parts.find((part) => part.type === "hour")?.value ?? "0",
    10,
  );
  const minute = Number.parseInt(
    parts.find((part) => part.type === "minute")?.value ?? "0",
    10,
  );
  return hour * 60 + minute;
}

export function formatShortWeekdayDay(date: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    day: "numeric",
  }).formatToParts(new Date(`${date}T12:00:00.000Z`));
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${weekday} ${day}`;
}
