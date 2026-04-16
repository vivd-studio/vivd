import type {
  TableBookingDateOverride,
  TableBookingPluginConfig,
  TableBookingSchedulePeriod,
} from "./config";

function getFormatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    ...options,
  });
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  return getFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatTimeInTimeZone(date: Date, timeZone: string): string {
  return getFormatter(timeZone, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDateTimeLabelInTimeZone(
  date: Date,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function parseTimeString(value: string): {
  hour: number;
  minute: number;
} {
  const [hourRaw, minuteRaw] = value.split(":");
  return {
    hour: Number.parseInt(hourRaw || "0", 10),
    minute: Number.parseInt(minuteRaw || "0", 10),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number.parseInt(values.year || "0", 10),
    Number.parseInt(values.month || "1", 10) - 1,
    Number.parseInt(values.day || "1", 10),
    Number.parseInt(values.hour || "0", 10),
    Number.parseInt(values.minute || "0", 10),
    Number.parseInt(values.second || "0", 10),
  );

  return asUtc - date.getTime();
}

export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  const { hour, minute } = parseTimeString(time);
  const baseUtc = Date.UTC(year, (month || 1) - 1, day || 1, hour, minute, 0, 0);
  let offset = getTimeZoneOffsetMs(new Date(baseUtc), timeZone);
  let result = new Date(baseUtc - offset);
  const secondOffset = getTimeZoneOffsetMs(result, timeZone);
  if (secondOffset !== offset) {
    offset = secondOffset;
    result = new Date(baseUtc - offset);
  }
  return result;
}

export function getWeekdayForDate(date: string): number {
  const value = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(value.getTime()) ? 0 : value.getUTCDay();
}

export function resolveServicePeriodsForDate(
  config: TableBookingPluginConfig,
  date: string,
): TableBookingSchedulePeriod[] {
  const override = config.dateOverrides.find(
    (candidate: TableBookingDateOverride) => candidate.date === date,
  );
  if (override) {
    if (override.closed) return [];
    return override.periods ?? [];
  }

  const weekday = getWeekdayForDate(date);
  return (
    config.weeklySchedule.find((entry) => entry.dayOfWeek === weekday)?.periods ?? []
  );
}

export function overlaps(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}

export function isSlotAlignedToPeriod(options: {
  date: string;
  time: string;
  config: TableBookingPluginConfig;
  period: TableBookingSchedulePeriod;
}): boolean {
  const { date, time, config, period } = options;
  const slotStart = zonedDateTimeToUtc(date, time, config.timezone).getTime();
  const periodStart = zonedDateTimeToUtc(
    date,
    period.startTime,
    config.timezone,
  ).getTime();
  const intervalMs = period.slotIntervalMinutes * 60_000;
  return slotStart >= periodStart && (slotStart - periodStart) % intervalMs === 0;
}

export function listCandidateSlots(options: {
  config: TableBookingPluginConfig;
  date: string;
  partySize: number;
}): Array<{
  time: string;
  startAt: Date;
  endAt: Date;
  maxConcurrentCovers: number;
}> {
  const periods = resolveServicePeriodsForDate(options.config, options.date);
  const slots: Array<{
    time: string;
    startAt: Date;
    endAt: Date;
    maxConcurrentCovers: number;
  }> = [];

  for (const period of periods) {
    if (typeof period.maxPartySize === "number" && options.partySize > period.maxPartySize) {
      continue;
    }

    const durationMinutes = period.durationMinutes ?? options.config.defaultDurationMinutes;
    let current = zonedDateTimeToUtc(options.date, period.startTime, options.config.timezone);
    const endBoundary = zonedDateTimeToUtc(
      options.date,
      period.endTime,
      options.config.timezone,
    );

    while (current < endBoundary) {
      const nextEnd = new Date(current.getTime() + durationMinutes * 60_000);
      if (nextEnd > endBoundary) break;

      slots.push({
        time: formatTimeInTimeZone(current, options.config.timezone),
        startAt: new Date(current),
        endAt: nextEnd,
        maxConcurrentCovers: period.maxConcurrentCovers,
      });

      current = new Date(current.getTime() + period.slotIntervalMinutes * 60_000);
    }
  }

  return slots;
}
