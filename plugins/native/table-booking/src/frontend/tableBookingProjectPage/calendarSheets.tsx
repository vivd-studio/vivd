import type { ChangeEvent } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  CAPACITY_MODE_LABELS,
  CAPACITY_MODE_OPTIONS,
  SOURCE_CHANNEL_OPTIONS,
  WEEKDAY_LABELS,
} from "./constants";
import { PeriodEditor, SchedulePreview } from "./shared";
import type {
  TableBookingCapacityAdjustmentRecord,
  TableBookingDateOverride,
  TableBookingSchedulePeriod,
  TableBookingWeeklyScheduleEntry,
} from "./types";
import {
  formatLongDate,
  getDateOverride,
  getWeeklyScheduleEntry,
  resolveScheduleForDate,
} from "./utils";
import type { TableBookingCapacityAdjustmentEditorState } from "./useCapacityAdjustmentEditor";
import type { TableBookingConfigDraftState } from "./useConfigDraft";
import type { TableBookingReservationEditorState } from "./useReservationEditor";

export function ReservationSheet({
  open,
  onOpenChange,
  editor,
  selectedDate,
  timezone,
  onSave,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: TableBookingReservationEditorState;
  selectedDate: string;
  timezone: string;
  onSave: () => void;
  pending: boolean;
}) {
  const isEditing = Boolean(editor.editingBookingId);

  const handleOpenChange = (next: boolean) => {
    if (!next && !pending) {
      editor.resetReservationEditor(selectedDate);
    }
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>
            {isEditing ? "Edit reservation" : "New reservation"}
          </SheetTitle>
          <SheetDescription>
            {isEditing
              ? "Update or move a booking without leaving the selected day."
              : `Capture a phone, walk-in, or staff-managed reservation for ${formatLongDate(selectedDate, timezone)}.`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={editor.reservationDate}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  editor.setReservationDate(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input
                type="time"
                value={editor.reservationTime}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  editor.setReservationTime(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Party size</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={editor.reservationPartySize}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  editor.setReservationPartySize(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select
                value={editor.reservationSourceChannel}
                onValueChange={(value: string) =>
                  editor.setReservationSourceChannel(
                    value as (typeof editor)["reservationSourceChannel"],
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Guest name</Label>
              <Input
                value={editor.reservationName}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  editor.setReservationName(event.target.value)
                }
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={editor.reservationEmail}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  editor.setReservationEmail(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={editor.reservationPhone}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  editor.setReservationPhone(event.target.value)
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                rows={3}
                value={editor.reservationNotes}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  editor.setReservationNotes(event.target.value)
                }
                placeholder="Dietary requests or service notes"
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={editor.sendGuestNotification}
                onCheckedChange={(value: boolean | "indeterminate") =>
                  editor.setSendGuestNotification(Boolean(value))
                }
              />
              Send guest confirmation email after save
            </label>
          </div>
        </div>
        <SheetFooter className="border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : isEditing ? (
              "Update reservation"
            ) : (
              "Create reservation"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function CapacityAdjustmentSheet({
  open,
  onOpenChange,
  editor,
  selectedDate,
  timezone,
  existingAdjustments,
  onDelete,
  deletePending,
  onSave,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: TableBookingCapacityAdjustmentEditorState;
  selectedDate: string;
  timezone: string;
  existingAdjustments: TableBookingCapacityAdjustmentRecord[];
  onDelete: (id: string) => void;
  deletePending: boolean;
  onSave: () => void;
  pending: boolean;
}) {
  const isEditing = Boolean(editor.editingAdjustmentId);

  const handleOpenChange = (next: boolean) => {
    if (!next && !pending) {
      editor.resetCapacityAdjustmentForm(selectedDate);
    }
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>
            {isEditing ? "Edit capacity hold" : "Hold capacity"}
          </SheetTitle>
          <SheetDescription>
            Temporarily reduce covers or close part of a service window on{" "}
            {formatLongDate(selectedDate, timezone)} without rewriting the
            weekly schedule.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {existingAdjustments.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Active holds</p>
              <div className="space-y-2">
                {existingAdjustments.map((adjustment) => (
                  <div
                    key={adjustment.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-background px-3 py-3"
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
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          editor.startEditingCapacityAdjustment(adjustment)
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(adjustment.id)}
                        disabled={deletePending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <p className="text-sm font-medium">
              {isEditing ? "Update hold" : "Add a hold"}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input
                  type="time"
                  value={editor.adjustmentStartTime}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    editor.setAdjustmentStartTime(event.target.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <Input
                  type="time"
                  value={editor.adjustmentEndTime}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    editor.setAdjustmentEndTime(event.target.value)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select
                  value={editor.adjustmentMode}
                  onValueChange={(value: string) =>
                    editor.setAdjustmentMode(
                      value as (typeof editor)["adjustmentMode"],
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
                  {editor.adjustmentMode === "effective_capacity_override"
                    ? "Effective capacity"
                    : "Covers"}
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={editor.adjustmentCapacityValue}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    editor.setAdjustmentCapacityValue(event.target.value)
                  }
                  disabled={editor.adjustmentMode === "closed"}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Reason</Label>
                <Input
                  value={editor.adjustmentReason}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    editor.setAdjustmentReason(event.target.value)
                  }
                  placeholder="Staff shortage, private event, walk-in holdback"
                />
              </div>
            </div>
          </div>
        </div>
        <SheetFooter className="border-t px-6 py-4">
          {isEditing ? (
            <Button
              variant="outline"
              onClick={() => editor.resetCapacityAdjustmentForm(selectedDate)}
              disabled={pending}
            >
              Stop editing
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Close
            </Button>
          )}
          <Button onClick={onSave} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : isEditing ? (
              "Update hold"
            ) : (
              "Add hold"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function HoursSheet({
  open,
  onOpenChange,
  selectedDate,
  timezone,
  draft,
  weeklySchedule,
  dateOverrides,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  timezone: string;
  draft: TableBookingConfigDraftState;
  weeklySchedule: TableBookingWeeklyScheduleEntry[];
  dateOverrides: TableBookingDateOverride[];
}) {
  const schedule = resolveScheduleForDate({
    weeklySchedule,
    dateOverrides,
    date: selectedDate,
  });
  const baseEntry = getWeeklyScheduleEntry(weeklySchedule, schedule.dayOfWeek);
  const override = getDateOverride(dateOverrides, selectedDate);
  const dayLabel = WEEKDAY_LABELS[schedule.dayOfWeek];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>Manage hours</SheetTitle>
          <SheetDescription>
            {formatLongDate(selectedDate, timezone)} — currently following the{" "}
            {override ? "date override" : `${dayLabel?.toLowerCase()} weekly template`}.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {!override ? (
            <>
              <section className="space-y-2 rounded-lg border bg-muted/20 p-4">
                <p className="text-sm font-medium">
                  Weekly template for {dayLabel}
                </p>
                <SchedulePreview
                  periods={baseEntry.periods}
                  defaultDurationMinutes={draft.defaultDurationMinutesNumber}
                  emptyCopy="No weekly service windows for this weekday."
                />
                <p className="text-xs text-muted-foreground">
                  Changes here update every {dayLabel?.toLowerCase()} across the calendar.
                </p>
              </section>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => draft.createOverrideFromBase(selectedDate)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add one-off hours for this date
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => draft.markOverrideClosed(selectedDate)}
                >
                  Close this date
                </Button>
              </div>
            </>
          ) : (
            <>
              <section className="space-y-3 rounded-lg border bg-amber-500/[0.05] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Date override</Badge>
                  <span className="text-sm font-medium">
                    Only applies on {formatLongDate(selectedDate, timezone)}
                  </span>
                </div>
                {override.closed ? (
                  <p className="text-sm text-muted-foreground">
                    This date is explicitly closed, even if the weekly schedule
                    would normally accept bookings.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {(override.periods ?? []).map((period, index) => (
                      <PeriodEditor
                        key={`${selectedDate}-${index}`}
                        period={period}
                        defaultDurationMinutes={draft.defaultDurationMinutesNumber}
                        onChange={(next: TableBookingSchedulePeriod) =>
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
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => draft.clearOverride(selectedDate)}
                  >
                    Revert to weekly template
                  </Button>
                  {override.closed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => draft.createOverrideFromBase(selectedDate)}
                    >
                      Reopen with custom hours
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => draft.markOverrideClosed(selectedDate)}
                    >
                      Close this date
                    </Button>
                  )}
                </div>
              </section>

              <section className="space-y-2 rounded-lg border bg-muted/20 p-4">
                <p className="text-sm font-medium">
                  Weekly template for {dayLabel}
                </p>
                <SchedulePreview
                  periods={baseEntry.periods}
                  defaultDurationMinutes={draft.defaultDurationMinutesNumber}
                  emptyCopy="No weekly service windows for this weekday."
                />
                <p className="text-xs text-muted-foreground">
                  Edit the weekly template in the Setup tab.
                </p>
              </section>
            </>
          )}
        </div>

        <SheetFooter className="border-t px-6 py-4">
          <p className="mr-auto text-xs text-muted-foreground">
            {formatScheduleSummaryLine(schedule.periods.length, schedule.isClosed)}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function formatScheduleSummaryLine(
  periodCount: number,
  isClosed: boolean,
): string {
  if (isClosed) return "Closed — no bookings accepted.";
  if (periodCount === 1) return "1 service window active.";
  return `${periodCount} service windows active.`;
}
