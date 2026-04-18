import { Fragment } from "react";
import { cn } from "@/lib/utils";
import {
  WEEKDAY_ORDER,
  WEEKDAY_SHORT_LABELS,
} from "./constants";
import type {
  DailyBookingSummary,
  TableBookingRecord,
} from "./types";
import type { TableBookingConfigDraftState } from "./useConfigDraft";
import {
  buildWeekDates,
  formatShortWeekdayDay,
  formatTime,
  formatTimeFromMinutes,
  getBookingMinutesInTimezone,
  getCalendarDayCaption,
  getCalendarDayTitle,
  getScheduleMaxConcurrentCovers,
  getWeekStartDate,
  parseTimeToMinutes,
  resolveScheduleForDate,
} from "./utils";

type MonthViewProps = {
  calendarDays: Array<{ date: string; inMonth: boolean }>;
  selectedDate: string;
  todayInTimezone: string;
  draft: TableBookingConfigDraftState;
  monthBookingSummary: Map<string, DailyBookingSummary>;
  onSelectDate: (date: string) => void;
};

export function MonthView({
  calendarDays,
  selectedDate,
  todayInTimezone,
  draft,
  monthBookingSummary,
  onSelectDate,
}: MonthViewProps) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {WEEKDAY_ORDER.map((day) => (
          <div
            key={day}
            className="px-3 py-2 text-xs font-medium text-muted-foreground"
          >
            {WEEKDAY_SHORT_LABELS[day]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {calendarDays.map((day, index) => {
          const schedule = resolveScheduleForDate({
            weeklySchedule: draft.weeklySchedule,
            dateOverrides: draft.dateOverrides,
            date: day.date,
          });
          const dailySummary = monthBookingSummary.get(day.date);
          const dailyCovers = dailySummary?.covers ?? 0;
          const dailyCapacity = getScheduleMaxConcurrentCovers(
            schedule.periods,
          );
          const utilization =
            dailyCapacity > 0 && !schedule.isClosed
              ? Math.min(100, (dailyCovers / dailyCapacity) * 100)
              : 0;
          const heatmapColor = getHeatmapColor(utilization);
          const isSelected = selectedDate === day.date;
          const isToday = todayInTimezone === day.date;

          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelectDate(day.date)}
              className={cn(
                "group relative flex min-h-[7.5rem] flex-col px-3 py-2 text-left transition-colors",
                index % 7 !== 6 && "border-r",
                index < calendarDays.length - 7 && "border-b",
                !day.inMonth && "bg-muted/15 text-muted-foreground/80",
                day.inMonth && "bg-card hover:bg-muted/20",
                day.inMonth && schedule.hasOverride && "bg-amber-500/[0.04]",
                isSelected && "bg-accent/30 ring-2 ring-inset ring-primary/40",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={cn(
                    "text-sm font-semibold",
                    isToday && "rounded-full bg-primary px-1.5 text-primary-foreground",
                  )}
                >
                  {Number.parseInt(day.date.slice(-2), 10)}
                </span>
                {schedule.hasOverride ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-amber-500"
                    title="Date override"
                  />
                ) : null}
              </div>

              <div className="mt-2 flex flex-1 flex-col gap-1.5">
                <p
                  className={cn(
                    "text-[11px] font-medium",
                    schedule.isClosed
                      ? "text-muted-foreground"
                      : "text-foreground",
                  )}
                >
                  {getCalendarDayTitle(schedule)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {getCalendarDayCaption(schedule)}
                </p>

                <div className="mt-auto space-y-1.5">
                  {dailySummary && dailySummary.count > 0 ? (
                    <p className="text-[11px] font-medium">
                      {dailySummary.covers} covers
                      <span className="ml-1 font-normal text-muted-foreground">
                        · {dailySummary.count} bookings
                      </span>
                    </p>
                  ) : null}
                  {!schedule.isClosed && dailyCapacity > 0 ? (
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-muted/60"
                      title={`${dailyCovers}/${dailyCapacity} covers · ${Math.round(utilization)}%`}
                    >
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width]",
                          heatmapColor,
                        )}
                        style={{ width: `${Math.max(utilization, 4)}%` }}
                      />
                    </div>
                  ) : (
                    <div className="h-1.5" />
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getHeatmapColor(utilization: number): string {
  if (utilization <= 0) return "bg-muted-foreground/20";
  if (utilization < 25) return "bg-emerald-400/70";
  if (utilization < 50) return "bg-emerald-500";
  if (utilization < 75) return "bg-amber-400";
  if (utilization < 100) return "bg-amber-500";
  return "bg-destructive";
}

type BookingTimelineCardProps = {
  booking: TableBookingRecord;
  timezone: string;
  startMinutes: number;
  endMinutes: number;
  pixelsPerMinute: number;
  onClick: () => void;
};

function BookingTimelineCard({
  booking,
  timezone,
  startMinutes,
  endMinutes,
  pixelsPerMinute,
  onClick,
}: BookingTimelineCardProps) {
  const bookingStart = getBookingMinutesInTimezone(
    booking.serviceStartAt,
    timezone,
  );
  const bookingEnd = getBookingMinutesInTimezone(
    booking.serviceEndAt,
    timezone,
  );
  const clampedStart = Math.max(startMinutes, bookingStart);
  const clampedEnd = Math.min(endMinutes, bookingEnd);
  const top = (clampedStart - startMinutes) * pixelsPerMinute;
  const height = Math.max(
    14,
    (clampedEnd - clampedStart) * pixelsPerMinute - 2,
  );
  const isCancelled =
    booking.status === "cancelled_by_guest" ||
    booking.status === "cancelled_by_staff";
  const isNoShow = booking.status === "no_show";
  const isCompleted = booking.status === "completed";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ top: `${top}px`, height: `${height}px` }}
      className={cn(
        "absolute left-1 right-1 overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] leading-tight transition-colors hover:z-10 hover:shadow-sm",
        isCancelled &&
          "border-destructive/50 bg-destructive/10 text-destructive line-through",
        isNoShow && "border-muted-foreground/40 bg-muted text-muted-foreground",
        isCompleted && "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        !isCancelled &&
          !isNoShow &&
          !isCompleted &&
          "border-primary/40 bg-primary/10 text-foreground",
      )}
    >
      <p className="truncate font-medium">
        {formatTime(booking.serviceStartAt, timezone)} · {booking.guestName || "Guest"}
      </p>
      <p className="truncate text-[10px] text-muted-foreground">
        Party of {booking.partySize}
      </p>
    </button>
  );
}

type WeekViewProps = {
  selectedDate: string;
  timezone: string;
  todayInTimezone: string;
  draft: TableBookingConfigDraftState;
  monthBookings: TableBookingRecord[];
  onSelectDate: (date: string) => void;
  onBookingClick: (booking: TableBookingRecord) => void;
};

export function WeekView({
  selectedDate,
  timezone,
  todayInTimezone,
  draft,
  monthBookings,
  onSelectDate,
  onBookingClick,
}: WeekViewProps) {
  const weekStart = getWeekStartDate(selectedDate);
  const weekDates = buildWeekDates(weekStart);
  const { startMinutes, endMinutes } = getVisibleRange(weekDates, draft);
  const pixelsPerMinute = 0.9;
  const totalHeight = (endMinutes - startMinutes) * pixelsPerMinute;
  const hourTicks: number[] = [];
  for (
    let minute = Math.ceil(startMinutes / 60) * 60;
    minute <= endMinutes;
    minute += 60
  ) {
    hourTicks.push(minute);
  }

  const bookingsByDate = groupBookingsByDate(monthBookings);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))] border-b bg-muted/30">
        <div />
        {weekDates.map((date) => {
          const isSelected = date === selectedDate;
          const isToday = date === todayInTimezone;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              className={cn(
                "flex flex-col items-center gap-0.5 border-l px-2 py-2 text-xs transition-colors hover:bg-muted/40",
                isSelected && "bg-accent/30",
              )}
            >
              <span
                className={cn(
                  "font-medium text-muted-foreground",
                  isToday && "text-primary",
                )}
              >
                {formatShortWeekdayDay(date, timezone)}
              </span>
            </button>
          );
        })}
      </div>
      <div
        className="relative grid grid-cols-[4rem_repeat(7,minmax(0,1fr))]"
        style={{ height: `${totalHeight}px` }}
      >
        <div className="relative">
          {hourTicks.map((minute) => (
            <div
              key={minute}
              className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground"
              style={{ top: `${(minute - startMinutes) * pixelsPerMinute}px` }}
            >
              {formatTimeFromMinutes(minute)}
            </div>
          ))}
        </div>
        {weekDates.map((date) => {
          const schedule = resolveScheduleForDate({
            weeklySchedule: draft.weeklySchedule,
            dateOverrides: draft.dateOverrides,
            date,
          });
          const isSelected = date === selectedDate;
          const dayBookings = bookingsByDate.get(date) ?? [];

          return (
            <div
              key={date}
              className={cn(
                "relative border-l",
                isSelected && "bg-accent/10",
              )}
            >
              {hourTicks.map((minute) => (
                <div
                  key={minute}
                  className="absolute inset-x-0 border-t border-muted/50"
                  style={{
                    top: `${(minute - startMinutes) * pixelsPerMinute}px`,
                  }}
                />
              ))}

              {schedule.periods.map((period, index) => {
                const periodStart = parseTimeToMinutes(period.startTime);
                const periodEnd = parseTimeToMinutes(period.endTime);
                const top = Math.max(0, periodStart - startMinutes) * pixelsPerMinute;
                const height =
                  (Math.min(endMinutes, periodEnd) -
                    Math.max(startMinutes, periodStart)) *
                  pixelsPerMinute;
                if (height <= 0) return null;
                return (
                  <div
                    key={`${date}-${index}`}
                    className={cn(
                      "absolute inset-x-0",
                      schedule.hasOverride
                        ? "bg-amber-500/[0.07]"
                        : "bg-emerald-500/[0.05]",
                    )}
                    style={{
                      top: `${top}px`,
                      height: `${height}px`,
                    }}
                  />
                );
              })}

              {schedule.isClosed ? (
                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
                  Closed
                </div>
              ) : null}

              {dayBookings.map((booking) => (
                <BookingTimelineCard
                  key={booking.id}
                  booking={booking}
                  timezone={timezone}
                  startMinutes={startMinutes}
                  endMinutes={endMinutes}
                  pixelsPerMinute={pixelsPerMinute}
                  onClick={() => onBookingClick(booking)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DayViewProps = {
  selectedDate: string;
  timezone: string;
  draft: TableBookingConfigDraftState;
  bookings: TableBookingRecord[];
  onBookingClick: (booking: TableBookingRecord) => void;
};

export function DayView({
  selectedDate,
  timezone,
  draft,
  bookings,
  onBookingClick,
}: DayViewProps) {
  const { startMinutes, endMinutes } = getVisibleRange([selectedDate], draft);
  const pixelsPerMinute = 1.3;
  const totalHeight = (endMinutes - startMinutes) * pixelsPerMinute;
  const hourTicks: number[] = [];
  for (
    let minute = Math.ceil(startMinutes / 60) * 60;
    minute <= endMinutes;
    minute += 60
  ) {
    hourTicks.push(minute);
  }

  const schedule = resolveScheduleForDate({
    weeklySchedule: draft.weeklySchedule,
    dateOverrides: draft.dateOverrides,
    date: selectedDate,
  });

  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        className="relative grid grid-cols-[5rem_minmax(0,1fr)]"
        style={{ height: `${totalHeight}px` }}
      >
        <div className="relative border-r bg-muted/20">
          {hourTicks.map((minute) => (
            <Fragment key={minute}>
              <div
                className="absolute right-3 -translate-y-1/2 text-[11px] text-muted-foreground"
                style={{
                  top: `${(minute - startMinutes) * pixelsPerMinute}px`,
                }}
              >
                {formatTimeFromMinutes(minute)}
              </div>
            </Fragment>
          ))}
        </div>

        <div className="relative">
          {hourTicks.map((minute) => (
            <div
              key={minute}
              className="absolute inset-x-0 border-t border-muted/50"
              style={{
                top: `${(minute - startMinutes) * pixelsPerMinute}px`,
              }}
            />
          ))}

          {schedule.periods.map((period, index) => {
            const periodStart = parseTimeToMinutes(period.startTime);
            const periodEnd = parseTimeToMinutes(period.endTime);
            const top = Math.max(0, periodStart - startMinutes) * pixelsPerMinute;
            const height =
              (Math.min(endMinutes, periodEnd) -
                Math.max(startMinutes, periodStart)) *
              pixelsPerMinute;
            if (height <= 0) return null;
            return (
              <div
                key={`${selectedDate}-${index}`}
                className={cn(
                  "absolute inset-x-0",
                  schedule.hasOverride
                    ? "bg-amber-500/[0.07]"
                    : "bg-emerald-500/[0.05]",
                )}
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                }}
              />
            );
          })}

          {schedule.isClosed ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Closed — no service window for this date
            </div>
          ) : null}

          {bookings.map((booking) => (
            <BookingTimelineCard
              key={booking.id}
              booking={booking}
              timezone={timezone}
              startMinutes={startMinutes}
              endMinutes={endMinutes}
              pixelsPerMinute={pixelsPerMinute}
              onClick={() => onBookingClick(booking)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function getVisibleRange(
  dates: string[],
  draft: TableBookingConfigDraftState,
): { startMinutes: number; endMinutes: number } {
  let earliest = 17 * 60;
  let latest = 22 * 60;
  let found = false;

  for (const date of dates) {
    const schedule = resolveScheduleForDate({
      weeklySchedule: draft.weeklySchedule,
      dateOverrides: draft.dateOverrides,
      date,
    });
    for (const period of schedule.periods) {
      const start = parseTimeToMinutes(period.startTime);
      const end = parseTimeToMinutes(period.endTime);
      if (!found) {
        earliest = start;
        latest = end;
        found = true;
      } else {
        if (start < earliest) earliest = start;
        if (end > latest) latest = end;
      }
    }
  }

  const padded = {
    startMinutes: Math.max(0, Math.floor(earliest / 60) * 60 - 60),
    endMinutes: Math.min(24 * 60, Math.ceil(latest / 60) * 60 + 60),
  };
  if (padded.endMinutes - padded.startMinutes < 4 * 60) {
    padded.endMinutes = padded.startMinutes + 4 * 60;
  }
  return padded;
}

function groupBookingsByDate(
  rows: TableBookingRecord[],
): Map<string, TableBookingRecord[]> {
  const map = new Map<string, TableBookingRecord[]>();
  for (const row of rows) {
    const list = map.get(row.serviceDate) ?? [];
    list.push(row);
    map.set(row.serviceDate, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) =>
      left.serviceStartAt.localeCompare(right.serviceStartAt),
    );
  }
  return map;
}
