import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pencil,
  Plus,
  Shield,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  CAPACITY_MODE_LABELS,
  WEEKDAY_LABELS,
} from "./constants";
import {
  CapacityAdjustmentSheet,
  HoursSheet,
  ReservationSheet,
} from "./calendarSheets";
import { DayView, MonthView, WeekView } from "./calendarViews";
import { BookingRow, SectionCard } from "./shared";
import type {
  SettingsTab,
  TableBookingBookingsPayload,
  TableBookingDayCapacityPayload,
  TableBookingRecord,
} from "./types";
import {
  addDaysToIsoDate,
  addMonthsToMonthKey,
  buildDailyBookingSummary,
  buildMonthGrid,
  buildWeekDates,
  formatLongDate,
  formatMonthLabel,
  formatShortWeekdayDay,
  getMonthStartDate,
  getTodayIsoDate,
  getWeekStartDate,
  resolveScheduleForDate,
} from "./utils";
import type { TableBookingConfigDraftState } from "./useConfigDraft";
import type { TableBookingCapacityAdjustmentEditorState } from "./useCapacityAdjustmentEditor";
import type { TableBookingReservationEditorState } from "./useReservationEditor";

type CalendarView = "month" | "week" | "day";

type CalendarTabProps = {
  timezone: string;
  visibleMonth: string;
  setVisibleMonth: Dispatch<SetStateAction<string>>;
  selectedDate: string;
  setSelectedDate: Dispatch<SetStateAction<string>>;
  setActiveTab: Dispatch<SetStateAction<SettingsTab>>;
  draft: TableBookingConfigDraftState;
  monthBookings: TableBookingBookingsPayload | undefined;
  monthBookingsQuery: {
    isLoading: boolean;
  };
  selectedDayBookings: TableBookingBookingsPayload | undefined;
  selectedDateBookingsQuery: {
    isLoading: boolean;
    error: { message: string } | null;
  };
  dayCapacity: TableBookingDayCapacityPayload | undefined;
  dayCapacityQuery: {
    isLoading: boolean;
    error: { message: string } | null;
  };
  reservationEditor: TableBookingReservationEditorState;
  capacityEditor: TableBookingCapacityAdjustmentEditorState;
  actionPending: boolean;
  reservationPending: boolean;
  saveReservation: () => void;
  capacitySavePending: boolean;
  saveCapacityAdjustment: () => void;
  deleteCapacityAdjustment: (adjustmentId: string) => void;
  deleteCapacityAdjustmentPending: boolean;
  runBookingAction: (actionId: string, bookingId: string) => void;
  onReservationSaved?: () => void;
  onCapacitySaved?: () => void;
  reservationSheetOpen: boolean;
  setReservationSheetOpen: Dispatch<SetStateAction<boolean>>;
  capacitySheetOpen: boolean;
  setCapacitySheetOpen: Dispatch<SetStateAction<boolean>>;
};

export function TableBookingCalendarTab({
  timezone,
  visibleMonth,
  setVisibleMonth,
  selectedDate,
  setSelectedDate,
  setActiveTab,
  draft,
  monthBookings,
  monthBookingsQuery,
  selectedDayBookings,
  selectedDateBookingsQuery,
  dayCapacity,
  dayCapacityQuery,
  reservationEditor,
  capacityEditor,
  actionPending,
  reservationPending,
  saveReservation,
  capacitySavePending,
  saveCapacityAdjustment,
  deleteCapacityAdjustment,
  deleteCapacityAdjustmentPending,
  runBookingAction,
  reservationSheetOpen,
  setReservationSheetOpen,
  capacitySheetOpen,
  setCapacitySheetOpen,
}: CalendarTabProps) {
  const [view, setView] = useState<CalendarView>("month");
  const [hoursSheetOpen, setHoursSheetOpen] = useState(false);

  const todayInTimezone = getTodayIsoDate(timezone);
  const calendarDays = buildMonthGrid(visibleMonth);
  const monthBookingRows = monthBookings?.rows ?? [];
  const monthBookingSummary = buildDailyBookingSummary(monthBookingRows);
  const selectedSchedule = resolveScheduleForDate({
    weeklySchedule: draft.weeklySchedule,
    dateOverrides: draft.dateOverrides,
    date: selectedDate,
  });
  const selectedDayRows = selectedDayBookings?.rows ?? [];
  const selectedDayCapacityWindows = dayCapacity?.windows ?? [];
  const selectedDayAdjustments = dayCapacity?.adjustments ?? [];
  const monthlyOverflowCount =
    (monthBookings?.total ?? 0) - monthBookingRows.length;

  const openAddReservation = () => {
    reservationEditor.resetReservationEditor(selectedDate);
    setReservationSheetOpen(true);
  };

  const openEditReservation = (booking: TableBookingRecord) => {
    reservationEditor.startEditingReservation(booking);
    setReservationSheetOpen(true);
  };

  const openCapacitySheet = () => {
    capacityEditor.resetCapacityAdjustmentForm(selectedDate);
    setCapacitySheetOpen(true);
  };

  const openHoursSheet = () => {
    setHoursSheetOpen(true);
  };

  const navigateBack = () => {
    if (view === "month") {
      const nextMonth = addMonthsToMonthKey(visibleMonth, -1);
      setVisibleMonth(nextMonth);
      if (!selectedDate.startsWith(nextMonth)) {
        setSelectedDate(getMonthStartDate(nextMonth));
      }
    } else if (view === "week") {
      const nextDate = addDaysToIsoDate(selectedDate, -7);
      setSelectedDate(nextDate);
      setVisibleMonth(nextDate.slice(0, 7));
    } else {
      const nextDate = addDaysToIsoDate(selectedDate, -1);
      setSelectedDate(nextDate);
      setVisibleMonth(nextDate.slice(0, 7));
    }
  };

  const navigateForward = () => {
    if (view === "month") {
      const nextMonth = addMonthsToMonthKey(visibleMonth, 1);
      setVisibleMonth(nextMonth);
      if (!selectedDate.startsWith(nextMonth)) {
        setSelectedDate(getMonthStartDate(nextMonth));
      }
    } else if (view === "week") {
      const nextDate = addDaysToIsoDate(selectedDate, 7);
      setSelectedDate(nextDate);
      setVisibleMonth(nextDate.slice(0, 7));
    } else {
      const nextDate = addDaysToIsoDate(selectedDate, 1);
      setSelectedDate(nextDate);
      setVisibleMonth(nextDate.slice(0, 7));
    }
  };

  const navigateToday = () => {
    const today = getTodayIsoDate(timezone);
    setSelectedDate(today);
    setVisibleMonth(today.slice(0, 7));
  };

  const rangeLabel = getRangeLabel({
    view,
    visibleMonth,
    selectedDate,
    timezone,
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.95fr)]">
      <SectionCard
        title="Schedule calendar"
        description={`Shown in ${timezone}. Click a date to inspect it; click a booking block to edit.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value: string) => {
                if (value) setView(value as CalendarView);
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="month" aria-label="Month view">
                <CalendarRange className="h-3.5 w-3.5" />
                Month
              </ToggleGroupItem>
              <ToggleGroupItem value="week" aria-label="Week view">
                <CalendarDays className="h-3.5 w-3.5" />
                Week
              </ToggleGroupItem>
              <ToggleGroupItem value="day" aria-label="Day view">
                <Calendar className="h-3.5 w-3.5" />
                Day
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={navigateBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[10rem] text-center text-sm font-medium">
              {rangeLabel}
            </div>
            <Button variant="outline" size="icon" onClick={navigateForward}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={navigateToday}>
              Today
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot className="bg-emerald-500" label="Low" />
            <LegendDot className="bg-amber-500" label="Near capacity" />
            <LegendDot className="bg-destructive" label="Full" />
            <LegendDot className="bg-amber-500/40" label="Date override" />
            {monthlyOverflowCount > 0 && view === "month" ? (
              <span>+{monthlyOverflowCount} more this month</span>
            ) : null}
          </div>
        </div>

        {monthBookingsQuery.isLoading && !monthBookings ? (
          <p className="text-xs text-muted-foreground">Loading bookings…</p>
        ) : null}

        {view === "month" ? (
          <MonthView
            calendarDays={calendarDays}
            selectedDate={selectedDate}
            todayInTimezone={todayInTimezone}
            draft={draft}
            monthBookingSummary={monthBookingSummary}
            onSelectDate={(date) => {
              setSelectedDate(date);
              setVisibleMonth(date.slice(0, 7));
            }}
          />
        ) : view === "week" ? (
          <WeekView
            selectedDate={selectedDate}
            timezone={timezone}
            todayInTimezone={todayInTimezone}
            draft={draft}
            monthBookings={monthBookingRows}
            onSelectDate={(date) => {
              setSelectedDate(date);
              setVisibleMonth(date.slice(0, 7));
            }}
            onBookingClick={openEditReservation}
          />
        ) : (
          <DayView
            selectedDate={selectedDate}
            timezone={timezone}
            draft={draft}
            bookings={selectedDayRows}
            onBookingClick={openEditReservation}
          />
        )}
      </SectionCard>

      <div className="space-y-4 xl:sticky xl:top-5 xl:self-start">
        <DaySummaryCard
          selectedDate={selectedDate}
          timezone={timezone}
          isClosed={selectedSchedule.isClosed}
          hasOverride={selectedSchedule.hasOverride}
          dayOfWeek={selectedSchedule.dayOfWeek}
          windows={selectedDayCapacityWindows}
          adjustments={selectedDayAdjustments}
          capacityLoading={dayCapacityQuery.isLoading && !dayCapacity}
          capacityError={dayCapacityQuery.error}
          onAddReservation={openAddReservation}
          onManageHours={openHoursSheet}
          onHoldCapacity={openCapacitySheet}
          onOpenWeeklySetup={() => setActiveTab("setup")}
        />

        <SectionCard
          title="Bookings"
          description={
            selectedDayRows.length === 0
              ? "No bookings for this date yet."
              : `${selectedDayRows.length} ${
                  selectedDayRows.length === 1 ? "booking" : "bookings"
                } · ${selectedDayRows.reduce(
                  (total, booking) => total + booking.partySize,
                  0,
                )} covers`
          }
          action={
            <Button size="sm" onClick={openAddReservation}>
              <UserPlus className="h-3.5 w-3.5" />
              Add
            </Button>
          }
        >
          {selectedDateBookingsQuery.isLoading && !selectedDayBookings ? (
            <p className="text-sm text-muted-foreground">Loading bookings…</p>
          ) : selectedDateBookingsQuery.error ? (
            <p className="text-sm text-destructive">
              {selectedDateBookingsQuery.error.message}
            </p>
          ) : selectedDayRows.length === 0 ? (
            <EmptyDay onAddReservation={openAddReservation} />
          ) : (
            <div className="space-y-2">
              {selectedDayRows.map((booking) => (
                <BookingRow
                  key={booking.id}
                  booking={booking}
                  timeZone={timezone}
                  actionPending={actionPending || reservationPending}
                  onEdit={() => openEditReservation(booking)}
                  onCancel={() => runBookingAction("cancel_booking", booking.id)}
                  onMarkNoShow={() =>
                    runBookingAction("mark_no_show", booking.id)
                  }
                  onMarkCompleted={() =>
                    runBookingAction("mark_completed", booking.id)
                  }
                />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <ReservationSheet
        open={reservationSheetOpen}
        onOpenChange={setReservationSheetOpen}
        editor={reservationEditor}
        selectedDate={selectedDate}
        timezone={timezone}
        onSave={saveReservation}
        pending={reservationPending}
      />

      <CapacityAdjustmentSheet
        open={capacitySheetOpen}
        onOpenChange={setCapacitySheetOpen}
        editor={capacityEditor}
        selectedDate={selectedDate}
        timezone={timezone}
        existingAdjustments={selectedDayAdjustments}
        onDelete={deleteCapacityAdjustment}
        deletePending={deleteCapacityAdjustmentPending}
        onSave={saveCapacityAdjustment}
        pending={capacitySavePending}
      />

      <HoursSheet
        open={hoursSheetOpen}
        onOpenChange={setHoursSheetOpen}
        selectedDate={selectedDate}
        timezone={timezone}
        draft={draft}
        weeklySchedule={draft.weeklySchedule}
        dateOverrides={draft.dateOverrides}
      />
    </div>
  );
}

function DaySummaryCard({
  selectedDate,
  timezone,
  isClosed,
  hasOverride,
  dayOfWeek,
  windows,
  adjustments,
  capacityLoading,
  capacityError,
  onAddReservation,
  onManageHours,
  onHoldCapacity,
  onOpenWeeklySetup,
}: {
  selectedDate: string;
  timezone: string;
  isClosed: boolean;
  hasOverride: boolean;
  dayOfWeek: number;
  windows: TableBookingDayCapacityPayload["windows"];
  adjustments: TableBookingDayCapacityPayload["adjustments"];
  capacityLoading: boolean;
  capacityError: { message: string } | null;
  onAddReservation: () => void;
  onManageHours: () => void;
  onHoldCapacity: () => void;
  onOpenWeeklySetup: () => void;
}) {
  const totalBooked = windows.reduce(
    (total, window) => total + window.bookedCovers,
    0,
  );
  const totalCapacity = windows.reduce(
    (total, window) => total + window.effectiveCapacity,
    0,
  );
  const totalRatio =
    totalCapacity > 0
      ? Math.min(100, Math.round((totalBooked / totalCapacity) * 100))
      : 0;

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">
            {formatLongDate(selectedDate, timezone)}
          </h2>
          <Badge variant={isClosed ? "secondary" : "success"}>
            {isClosed ? "Closed" : "Open"}
          </Badge>
          {hasOverride ? (
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
              Date override
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {hasOverride
            ? "One-off hours for this date only."
            : `Follows the ${WEEKDAY_LABELS[dayOfWeek]?.toLowerCase()} weekly template.`}
        </p>
      </div>

      {totalCapacity > 0 ? (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Overall capacity</span>
            <span>
              {totalBooked} / {totalCapacity} covers · {totalRatio}%
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                totalRatio >= 100
                  ? "bg-destructive"
                  : totalRatio >= 75
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
              style={{ width: `${totalRatio}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <Button size="sm" onClick={onAddReservation}>
          <Plus className="h-3.5 w-3.5" />
          Reservation
        </Button>
        <Button size="sm" variant="outline" onClick={onManageHours}>
          <Clock className="h-3.5 w-3.5" />
          Hours
        </Button>
        <Button size="sm" variant="outline" onClick={onHoldCapacity}>
          <Shield className="h-3.5 w-3.5" />
          Holds
          {adjustments.length > 0 ? (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {adjustments.length}
            </Badge>
          ) : null}
        </Button>
      </div>

      <div className="space-y-2">
        {capacityLoading ? (
          <p className="text-xs text-muted-foreground">Loading capacity…</p>
        ) : capacityError ? (
          <p className="text-xs text-destructive">{capacityError.message}</p>
        ) : windows.length === 0 ? (
          <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
            No service windows for this date.{" "}
            <button
              type="button"
              onClick={onManageHours}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Add hours
            </button>
            .
          </div>
        ) : (
          windows.map((window) => (
            <CapacityWindowRow
              key={window.key}
              window={window}
              onEdit={onManageHours}
            />
          ))
        )}
      </div>

      {adjustments.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Active holds
          </p>
          <div className="flex flex-wrap gap-1.5">
            {adjustments.map((adjustment) => (
              <Badge
                key={adjustment.id}
                variant="outline"
                className="gap-1 bg-background"
              >
                {CAPACITY_MODE_LABELS[adjustment.mode]} · {adjustment.startTime}
                -{adjustment.endTime}
                {adjustment.capacityValue
                  ? ` · ${adjustment.capacityValue}`
                  : ""}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {!hasOverride ? (
        <button
          type="button"
          onClick={onOpenWeeklySetup}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          <Pencil className="mr-1 inline h-3 w-3" />
          Edit weekly template in Setup
        </button>
      ) : null}
    </section>
  );
}

function CapacityWindowRow({
  window,
  onEdit,
}: {
  window: TableBookingDayCapacityPayload["windows"][number];
  onEdit: () => void;
}) {
  const ratio =
    window.effectiveCapacity > 0
      ? Math.min(
          100,
          Math.round((window.bookedCovers / window.effectiveCapacity) * 100),
        )
      : 0;

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">
              {window.startTime} – {window.endTime}
            </p>
            {window.isClosed ? (
              <Badge variant="secondary" className="text-[10px]">
                Closed
              </Badge>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {window.bookedCovers}/{window.effectiveCapacity} covers · every{" "}
            {window.slotIntervalMinutes}m
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Edit
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            window.isClosed
              ? "bg-muted-foreground/50"
              : ratio >= 100
                ? "bg-destructive"
                : ratio >= 75
                  ? "bg-amber-500"
                  : "bg-emerald-500",
          )}
          style={{ width: `${window.isClosed ? 100 : ratio}%` }}
        />
      </div>
    </div>
  );
}

function EmptyDay({ onAddReservation }: { onAddReservation: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed bg-muted/10 p-4">
      <p className="text-sm text-muted-foreground">
        No bookings for this date yet.
      </p>
      <Button size="sm" variant="outline" onClick={onAddReservation}>
        <Plus className="h-3.5 w-3.5" />
        Add reservation
      </Button>
    </div>
  );
}

function LegendDot({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", className)} />
      {label}
    </span>
  );
}

function getRangeLabel({
  view,
  visibleMonth,
  selectedDate,
  timezone,
}: {
  view: CalendarView;
  visibleMonth: string;
  selectedDate: string;
  timezone: string;
}): string {
  if (view === "month") {
    return formatMonthLabel(visibleMonth, timezone);
  }
  if (view === "day") {
    return formatLongDate(selectedDate, timezone);
  }
  const weekStart = getWeekStartDate(selectedDate);
  const dates = buildWeekDates(weekStart);
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  return `${formatShortWeekdayDay(first, timezone)} — ${formatShortWeekdayDay(last, timezone)}`;
}
