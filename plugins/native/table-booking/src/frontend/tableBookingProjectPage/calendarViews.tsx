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

const VIEW_TOP_PAD = 12;
const VIEW_BOTTOM_PAD = 8;
const TIMELINE_MAX_HEIGHT_CLASS = "max-h-[560px]";

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

type LaidOutBooking = {
  booking: TableBookingRecord;
  startMinutes: number;
  endMinutes: number;
  lane: number;
  totalLanes: number;
};

function layoutBookingsWithLanes(
  bookings: TableBookingRecord[],
  timezone: string,
): LaidOutBooking[] {
  const withRange = bookings.map((booking) => ({
    booking,
    startMinutes: getBookingMinutesInTimezone(booking.serviceStartAt, timezone),
    endMinutes: getBookingMinutesInTimezone(booking.serviceEndAt, timezone),
  }));
  withRange.sort(
    (left, right) =>
      left.startMinutes - right.startMinutes ||
      left.endMinutes - right.endMinutes,
  );

  const result: LaidOutBooking[] = [];
  let cluster: typeof withRange = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const laneByIndex: number[] = [];
    cluster.forEach((entry) => {
      let lane = laneEnds.findIndex((end) => end <= entry.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(entry.endMinutes);
      } else {
        laneEnds[lane] = entry.endMinutes;
      }
      laneByIndex.push(lane);
    });
    const totalLanes = laneEnds.length;
    cluster.forEach((entry, index) => {
      result.push({
        booking: entry.booking,
        startMinutes: entry.startMinutes,
        endMinutes: entry.endMinutes,
        lane: laneByIndex[index]!,
        totalLanes,
      });
    });
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const entry of withRange) {
    if (entry.startMinutes >= clusterEnd) {
      flushCluster();
    }
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.endMinutes);
  }
  flushCluster();

  return result;
}

type BookingTimelineCardProps = {
  entry: LaidOutBooking;
  timezone: string;
  startMinutes: number;
  endMinutes: number;
  pixelsPerMinute: number;
  topOffset: number;
  onClick: () => void;
};

function BookingTimelineCard({
  entry,
  timezone,
  startMinutes,
  endMinutes,
  pixelsPerMinute,
  topOffset,
  onClick,
}: BookingTimelineCardProps) {
  const clampedStart = Math.max(startMinutes, entry.startMinutes);
  const clampedEnd = Math.min(endMinutes, entry.endMinutes);
  const top = topOffset + (clampedStart - startMinutes) * pixelsPerMinute;
  const height = Math.max(
    14,
    (clampedEnd - clampedStart) * pixelsPerMinute - 2,
  );
  const laneWidth = 100 / entry.totalLanes;
  const left = laneWidth * entry.lane;
  const isCancelled =
    entry.booking.status === "cancelled_by_guest" ||
    entry.booking.status === "cancelled_by_staff";
  const isNoShow = entry.booking.status === "no_show";
  const isCompleted = entry.booking.status === "completed";
  const isCompact = entry.totalLanes >= 3;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${left}% + 2px)`,
        width: `calc(${laneWidth}% - 4px)`,
      }}
      className={cn(
        "absolute overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] leading-tight transition-colors hover:z-10 hover:shadow-sm",
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
        {formatTime(entry.booking.serviceStartAt, timezone)}
        {isCompact ? " " : " · "}
        {entry.booking.guestName || "Guest"}
      </p>
      {!isCompact ? (
        <p className="truncate text-[10px] text-muted-foreground">
          Party of {entry.booking.partySize}
        </p>
      ) : null}
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
  const bodyHeight = totalHeight + VIEW_TOP_PAD + VIEW_BOTTOM_PAD;
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
      <div className={cn("relative overflow-y-auto", TIMELINE_MAX_HEIGHT_CLASS)}>
        <div className="sticky top-0 z-20 grid grid-cols-[4rem_repeat(7,minmax(0,1fr))] border-b bg-muted/50 backdrop-blur-sm">
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
          style={{ height: `${bodyHeight}px` }}
        >
          <div className="relative">
            {hourTicks.map((minute) => (
              <div
                key={minute}
                className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
                style={{
                  top: `${VIEW_TOP_PAD + (minute - startMinutes) * pixelsPerMinute}px`,
                }}
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
            const laidOut = layoutBookingsWithLanes(dayBookings, timezone);

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
                      top: `${VIEW_TOP_PAD + (minute - startMinutes) * pixelsPerMinute}px`,
                    }}
                  />
                ))}

                {schedule.periods.map((period, index) => {
                  const periodStart = parseTimeToMinutes(period.startTime);
                  const periodEnd = parseTimeToMinutes(period.endTime);
                  const top =
                    VIEW_TOP_PAD +
                    Math.max(0, periodStart - startMinutes) * pixelsPerMinute;
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
                  <div
                    className="absolute inset-x-0 flex items-center justify-center text-[11px] text-muted-foreground"
                    style={{ top: `${VIEW_TOP_PAD}px`, height: `${totalHeight}px` }}
                  >
                    Closed
                  </div>
                ) : null}

                {laidOut.map((entry) => (
                  <BookingTimelineCard
                    key={entry.booking.id}
                    entry={entry}
                    timezone={timezone}
                    startMinutes={startMinutes}
                    endMinutes={endMinutes}
                    pixelsPerMinute={pixelsPerMinute}
                    topOffset={VIEW_TOP_PAD}
                    onClick={() => onBookingClick(entry.booking)}
                  />
                ))}
              </div>
            );
          })}
        </div>
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
  const bodyHeight = totalHeight + VIEW_TOP_PAD + VIEW_BOTTOM_PAD;
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

  const laidOut = layoutBookingsWithLanes(bookings, timezone);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={cn("relative overflow-y-auto", TIMELINE_MAX_HEIGHT_CLASS)}>
        <div
          className="relative grid grid-cols-[5rem_minmax(0,1fr)]"
          style={{ height: `${bodyHeight}px` }}
        >
          <div className="relative border-r bg-muted/20">
            {hourTicks.map((minute) => (
              <Fragment key={minute}>
                <div
                  className="absolute right-3 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums"
                  style={{
                    top: `${VIEW_TOP_PAD + (minute - startMinutes) * pixelsPerMinute}px`,
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
                  top: `${VIEW_TOP_PAD + (minute - startMinutes) * pixelsPerMinute}px`,
                }}
              />
            ))}

            {schedule.periods.map((period, index) => {
              const periodStart = parseTimeToMinutes(period.startTime);
              const periodEnd = parseTimeToMinutes(period.endTime);
              const top =
                VIEW_TOP_PAD +
                Math.max(0, periodStart - startMinutes) * pixelsPerMinute;
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
              <div
                className="absolute inset-x-0 flex items-center justify-center text-sm text-muted-foreground"
                style={{ top: `${VIEW_TOP_PAD}px`, height: `${totalHeight}px` }}
              >
                Closed — no service window for this date
              </div>
            ) : null}

            {laidOut.map((entry) => (
              <BookingTimelineCard
                key={entry.booking.id}
                entry={entry}
                timezone={timezone}
                startMinutes={startMinutes}
                endMinutes={endMinutes}
                pixelsPerMinute={pixelsPerMinute}
                topOffset={VIEW_TOP_PAD}
                onClick={() => onBookingClick(entry.booking)}
              />
            ))}
          </div>
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
