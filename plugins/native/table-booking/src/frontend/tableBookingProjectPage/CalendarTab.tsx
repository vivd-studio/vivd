import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CAPACITY_MODE_LABELS,
  CAPACITY_MODE_OPTIONS,
  SOURCE_CHANNEL_OPTIONS,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  WEEKDAY_SHORT_LABELS,
} from "./constants";
import {
  BookingRow,
  CapacityWindowCard,
  PeriodEditor,
  SchedulePreview,
  SectionCard,
} from "./shared";
import type {
  SettingsTab,
  TableBookingBookingsPayload,
  TableBookingDayCapacityPayload,
} from "./types";
import {
  addMonthsToMonthKey,
  buildDailyBookingSummary,
  buildMonthGrid,
  formatLongDate,
  formatMonthLabel,
  getCalendarDayCaption,
  getCalendarDayTitle,
  getMonthStartDate,
  getTodayIsoDate,
  getDateOverride,
  getWeeklyScheduleEntry,
  resolveScheduleForDate,
} from "./utils";
import type { TableBookingConfigDraftState } from "./useConfigDraft";
import type { TableBookingCapacityAdjustmentEditorState } from "./useCapacityAdjustmentEditor";
import type { TableBookingReservationEditorState } from "./useReservationEditor";

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
}: CalendarTabProps) {
  const todayInTimezone = getTodayIsoDate(timezone);
  const calendarDays = buildMonthGrid(visibleMonth);
  const monthBookingSummary = buildDailyBookingSummary(monthBookings?.rows ?? []);
  const selectedSchedule = resolveScheduleForDate({
    weeklySchedule: draft.weeklySchedule,
    dateOverrides: draft.dateOverrides,
    date: selectedDate,
  });
  const selectedBaseEntry = getWeeklyScheduleEntry(
    draft.weeklySchedule,
    selectedSchedule.dayOfWeek,
  );
  const selectedOverride = getDateOverride(draft.dateOverrides, selectedDate);
  const selectedDaySummary = monthBookingSummary.get(selectedDate);
  const selectedDayRows = selectedDayBookings?.rows ?? [];
  const selectedDayCapacityWindows = dayCapacity?.windows ?? [];
  const selectedDayAdjustments = dayCapacity?.adjustments ?? [];
  const selectedDayCountLabel = selectedDaySummary
    ? `${selectedDaySummary.count} bookings · ${selectedDaySummary.covers} covers`
    : "No bookings yet";
  const monthlyOverflowCount =
    (monthBookings?.total ?? 0) - (monthBookings?.rows.length ?? 0);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.95fr)]">
      <SectionCard
        title="Schedule calendar"
        description={`Month view in ${timezone}. Click a date to inspect bookings or create a one-off override.`}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const nextMonth = addMonthsToMonthKey(visibleMonth, -1);
                setVisibleMonth(nextMonth);
                if (!selectedDate.startsWith(nextMonth)) {
                  setSelectedDate(getMonthStartDate(nextMonth));
                }
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[10rem] text-center text-sm font-medium">
              {formatMonthLabel(visibleMonth, timezone)}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const nextMonth = addMonthsToMonthKey(visibleMonth, 1);
                setVisibleMonth(nextMonth);
                if (!selectedDate.startsWith(nextMonth)) {
                  setSelectedDate(getMonthStartDate(nextMonth));
                }
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = getTodayIsoDate(timezone);
                setSelectedDate(today);
                setVisibleMonth(today.slice(0, 7));
              }}
            >
              Today
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Weekly hours fill the month</span>
          <span>Overrides replace a day</span>
          <span>Bookings update every 30s</span>
          {monthlyOverflowCount > 0 ? (
            <span>+{monthlyOverflowCount} more bookings this month</span>
          ) : null}
        </div>

        {monthBookingsQuery.isLoading && !monthBookings ? (
          <p className="text-sm text-muted-foreground">
            Loading monthly bookings...
          </p>
        ) : null}

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
              const isSelected = selectedDate === day.date;
              const isToday = todayInTimezone === day.date;

              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => {
                    setSelectedDate(day.date);
                    setVisibleMonth(day.date.slice(0, 7));
                  }}
                  className={cn(
                    "flex min-h-[8.75rem] flex-col px-3 py-3 text-left transition-colors",
                    index % 7 !== 6 && "border-r",
                    index < calendarDays.length - 7 && "border-b",
                    !day.inMonth && "bg-muted/15 text-muted-foreground/80",
                    day.inMonth && "bg-card hover:bg-muted/20",
                    day.inMonth &&
                      !schedule.isClosed &&
                      !schedule.hasOverride &&
                      "bg-emerald-500/[0.03]",
                    day.inMonth && schedule.hasOverride && "bg-amber-500/[0.05]",
                    isSelected && "bg-accent/30",
                    isToday && "ring-1 ring-primary/30 ring-inset",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {Number.parseInt(day.date.slice(-2), 10)}
                    </span>
                    {isToday ? (
                      <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
                        Today
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-1 flex-col gap-2">
                    <div className="space-y-1">
                      <p
                        className={cn(
                          "text-xs font-medium",
                          schedule.isClosed
                            ? "text-muted-foreground"
                            : "text-foreground",
                        )}
                      >
                        {getCalendarDayTitle(schedule)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {getCalendarDayCaption(schedule)}
                      </p>
                    </div>
                    {dailySummary ? (
                      <div className="mt-auto rounded-md border bg-background/80 px-2 py-1 text-xs">
                        {dailySummary.count} bookings · {dailySummary.covers} covers
                      </div>
                    ) : (
                      <div className="mt-auto" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </SectionCard>

      <div className="space-y-5 xl:sticky xl:top-5 xl:self-start">
        <SectionCard
          title={formatLongDate(selectedDate, timezone)}
          description={`${WEEKDAY_LABELS[selectedSchedule.dayOfWeek]} template · ${selectedDayCountLabel}`}
          action={
            <div className="flex flex-wrap gap-2">
              <Badge variant={selectedSchedule.isClosed ? "secondary" : "success"}>
                {selectedSchedule.isClosed ? "Closed" : "Open"}
              </Badge>
              <Badge variant="outline">
                {selectedSchedule.hasOverride ? "Date override" : "Weekly hours"}
              </Badge>
            </div>
          }
        >
          <div className="space-y-3">
            {!selectedOverride ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      This date uses the{" "}
                      {WEEKDAY_LABELS[selectedSchedule.dayOfWeek].toLowerCase()}{" "}
                      weekly schedule.
                    </p>
                  </div>
                  <SchedulePreview
                    periods={selectedBaseEntry.periods}
                    defaultDurationMinutes={draft.defaultDurationMinutesNumber}
                    emptyCopy="No weekly service windows are set for this weekday."
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => draft.createOverrideFromBase(selectedDate)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add custom hours
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => draft.markOverrideClosed(selectedDate)}
                  >
                    Mark closed
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab("setup")}
                  >
                    Edit weekly hours
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => draft.clearOverride(selectedDate)}
                  >
                    Use weekly hours
                  </Button>
                  {selectedOverride.closed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => draft.createOverrideFromBase(selectedDate)}
                    >
                      Add custom hours
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => draft.markOverrideClosed(selectedDate)}
                    >
                      Mark closed
                    </Button>
                  )}
                </div>

                {selectedOverride.closed ? (
                  <div className="rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                    This date is explicitly closed, even if the weekly schedule
                    would normally accept bookings.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(selectedOverride.periods ?? []).map((period, index) => (
                      <PeriodEditor
                        key={`${selectedDate}-${index}`}
                        period={period}
                        defaultDurationMinutes={draft.defaultDurationMinutesNumber}
                        onChange={(next) =>
                          draft.updateOverridePeriod(selectedDate, index, next)
                        }
                        onRemove={() =>
                          draft.removeOverridePeriod(selectedDate, index)
                        }
                      />
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => draft.addOverridePeriod(selectedDate)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add service window
                    </Button>
                  </div>
                )}

                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-sm font-medium">
                    Weekly baseline for {WEEKDAY_LABELS[selectedSchedule.dayOfWeek]}
                  </p>
                  <div className="mt-2">
                    <SchedulePreview
                      periods={selectedBaseEntry.periods}
                      defaultDurationMinutes={draft.defaultDurationMinutesNumber}
                      emptyCopy="No weekly hours for this weekday."
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Service-window capacity"
          description="Booked versus effective capacity for the selected date."
        >
          {dayCapacityQuery.isLoading && !dayCapacity ? (
            <p className="text-sm text-muted-foreground">
              Loading capacity for this date...
            </p>
          ) : dayCapacityQuery.error ? (
            <p className="text-sm text-destructive">
              Could not load capacity: {dayCapacityQuery.error.message}
            </p>
          ) : selectedDayCapacityWindows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No service windows are configured for this date.
            </p>
          ) : (
            <div className="space-y-3">
              {selectedDayCapacityWindows.map((window) => (
                <CapacityWindowCard key={window.key} window={window} />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Selected-day bookings"
          description="Live reservations and staff actions for the currently selected date."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => reservationEditor.resetReservationEditor(selectedDate)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add reservation
            </Button>
          }
        >
          {selectedDateBookingsQuery.isLoading && !selectedDayBookings ? (
            <p className="text-sm text-muted-foreground">
              Loading bookings for this date...
            </p>
          ) : selectedDateBookingsQuery.error ? (
            <p className="text-sm text-destructive">
              Could not load bookings for this date:{" "}
              {selectedDateBookingsQuery.error.message}
            </p>
          ) : selectedDayRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bookings are scheduled for this date yet.
            </p>
          ) : (
            <div className="space-y-3">
              {selectedDayRows.map((booking) => (
                <BookingRow
                  key={booking.id}
                  booking={booking}
                  timeZone={timezone}
                  actionPending={actionPending || reservationPending}
                  onEdit={() => reservationEditor.startEditingReservation(booking)}
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

        <SectionCard
          title={
            reservationEditor.editingBookingId
              ? "Reservation editor"
              : "Operator reservation"
          }
          description={
            reservationEditor.editingBookingId
              ? "Update or move a booking without leaving the selected day."
              : "Capture phone, walk-in, or staff-managed reservations so capacity stays accurate."
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={reservationEditor.reservationDate}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  reservationEditor.setReservationDate(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input
                type="time"
                value={reservationEditor.reservationTime}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  reservationEditor.setReservationTime(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Party size</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={reservationEditor.reservationPartySize}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  reservationEditor.setReservationPartySize(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select
                value={reservationEditor.reservationSourceChannel}
                onValueChange={(value) =>
                  reservationEditor.setReservationSourceChannel(
                    value as (typeof reservationEditor)["reservationSourceChannel"],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_CHANNEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Guest name</Label>
              <Input
                value={reservationEditor.reservationName}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  reservationEditor.setReservationName(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={reservationEditor.reservationEmail}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  reservationEditor.setReservationEmail(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={reservationEditor.reservationPhone}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  reservationEditor.setReservationPhone(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                rows={3}
                value={reservationEditor.reservationNotes}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  reservationEditor.setReservationNotes(event.target.value)
                }
                placeholder="Dietary requests or service notes"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={reservationEditor.sendGuestNotification}
              onCheckedChange={(value) =>
                reservationEditor.setSendGuestNotification(Boolean(value))
              }
            />
            Send guest confirmation email after save
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveReservation} disabled={reservationPending}>
              {reservationPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : reservationEditor.editingBookingId ? (
                "Update reservation"
              ) : (
                "Create reservation"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                reservationEditor.resetReservationEditor(selectedDate)
              }
              disabled={reservationPending}
            >
              {reservationEditor.editingBookingId ? "Stop editing" : "Reset"}
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title="Capacity controls"
          description="Hold back covers or temporarily close part of a service window without rewriting the weekly schedule."
        >
          {selectedDayAdjustments.length > 0 ? (
            <div className="space-y-2">
              {selectedDayAdjustments.map((adjustment) => (
                <div
                  key={adjustment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-3 py-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {CAPACITY_MODE_LABELS[adjustment.mode]}
                      </Badge>
                      <span className="text-sm font-medium">
                        {adjustment.startTime} - {adjustment.endTime}
                      </span>
                      {adjustment.capacityValue ? (
                        <span className="text-xs text-muted-foreground">
                          {adjustment.capacityValue} covers
                        </span>
                      ) : null}
                    </div>
                    {adjustment.reason ? (
                      <p className="text-xs text-muted-foreground">
                        {adjustment.reason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        capacityEditor.startEditingCapacityAdjustment(adjustment)
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteCapacityAdjustment(adjustment.id)}
                      disabled={deleteCapacityAdjustmentPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No capacity adjustments for this date yet.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input
                type="time"
                value={capacityEditor.adjustmentStartTime}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  capacityEditor.setAdjustmentStartTime(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input
                type="time"
                value={capacityEditor.adjustmentEndTime}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  capacityEditor.setAdjustmentEndTime(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select
                value={capacityEditor.adjustmentMode}
                onValueChange={(value) =>
                  capacityEditor.setAdjustmentMode(
                    value as (typeof capacityEditor)["adjustmentMode"],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAPACITY_MODE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {capacityEditor.adjustmentMode === "effective_capacity_override"
                  ? "Effective capacity"
                  : "Covers"}
              </Label>
              <Input
                type="number"
                min={1}
                value={capacityEditor.adjustmentCapacityValue}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  capacityEditor.setAdjustmentCapacityValue(event.target.value)
                }
                disabled={capacityEditor.adjustmentMode === "closed"}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Reason</Label>
              <Input
                value={capacityEditor.adjustmentReason}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  capacityEditor.setAdjustmentReason(event.target.value)
                }
                placeholder="Staff shortage, private event, walk-in holdback"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveCapacityAdjustment} disabled={capacitySavePending}>
              {capacitySavePending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : capacityEditor.editingAdjustmentId ? (
                "Update adjustment"
              ) : (
                "Add adjustment"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => capacityEditor.resetCapacityAdjustmentForm(selectedDate)}
              disabled={capacitySavePending}
            >
              {capacityEditor.editingAdjustmentId ? "Stop editing" : "Reset"}
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
