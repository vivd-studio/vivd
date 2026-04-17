import type { ChangeEvent, ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BellRing,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Loader2,
  NotebookPen,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAppConfig } from "@/lib/AppConfigContext";
import { authClient } from "@/lib/auth-client";
import { formatDocumentTitle } from "@/lib/brand";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import {
  getPluginAccessRequestLabel,
  getProjectPluginPresentation,
  isPluginAccessRequestPending,
} from "@/plugins/presentation";
import { cn } from "@/lib/utils";
import {
  tableBookingPluginConfigSchema,
  type TableBookingDateOverride,
  type TableBookingPluginConfig,
  type TableBookingSchedulePeriod,
  type TableBookingWeeklyScheduleEntry,
} from "../backend/config";
import {
  TABLE_BOOKING_BOOKINGS_READ_ID,
  TABLE_BOOKING_SUMMARY_READ_ID,
  type TableBookingBookingsPayload,
  type TableBookingRecord,
  type TableBookingSummaryPayload,
} from "../shared/summary";

type TableBookingProjectPageProps = {
  projectSlug: string;
  isEmbedded?: boolean;
};

type TableBookingStatus =
  TableBookingBookingsPayload["rows"][number]["status"];
type TableBookingSourceChannel =
  TableBookingBookingsPayload["rows"][number]["sourceChannel"];
type TableBookingDayCapacityPayload =
  RouterOutputs["plugins"]["tableBooking"]["dayCapacity"];
type TableBookingCapacityAdjustmentRecord =
  TableBookingDayCapacityPayload["adjustments"][number];
type TableBookingCapacityMode =
  TableBookingCapacityAdjustmentRecord["mode"];

type SettingsTab = "calendar" | "bookings" | "setup" | "install";

type DailyBookingSummary = {
  count: number;
  covers: number;
  confirmed: number;
  cancelled: number;
  noShow: number;
  completed: number;
};

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const WEEKDAY_LABELS: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const WEEKDAY_SHORT_LABELS: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

const STATUS_LABELS: Record<TableBookingStatus, string> = {
  confirmed: "Confirmed",
  cancelled_by_guest: "Cancelled by guest",
  cancelled_by_staff: "Cancelled by staff",
  no_show: "No-show",
  completed: "Completed",
};

const SOURCE_CHANNEL_LABELS: Record<TableBookingSourceChannel, string> = {
  online: "Online",
  phone: "Phone",
  walk_in: "Walk-in",
  staff_manual: "Staff",
};

const CAPACITY_MODE_LABELS: Record<TableBookingCapacityMode, string> = {
  cover_holdback: "Cover holdback",
  effective_capacity_override: "Effective capacity",
  closed: "Closed window",
};

function parseListInput(value: string): string[] {
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

function formatListInput(values: string[]): string {
  return values.join("\n");
}

function formatDateTime(value: string, timeZone: string): string {
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

function formatTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTimeInputValue(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "17:00";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatLongDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatMonthLabel(value: string, timeZone: string): string {
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number.parseInt(yearRaw || "0", 10);
  const month = Number.parseInt(monthRaw || "1", 10);
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 15, 12, 0, 0)));
}

function getTodayIsoDate(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getMonthStartDate(monthKey: string): string {
  return `${monthKey}-01`;
}

function getMonthRange(monthKey: string): {
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

function addMonthsToMonthKey(monthKey: string, offset: number): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number.parseInt(yearRaw || "0", 10);
  const month = Number.parseInt(monthRaw || "1", 10);
  const next = new Date(Date.UTC(year, month - 1 + offset, 1));

  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getWeekdayFromIsoDate(value: string): number {
  return new Date(`${value}T12:00:00.000Z`).getUTCDay();
}

function buildMonthGrid(monthKey: string): Array<{
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

function sortPeriods(
  periods: TableBookingSchedulePeriod[],
): TableBookingSchedulePeriod[] {
  return [...periods]
    .map((period) => ({ ...period }))
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
}

function normalizeWeeklySchedule(
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

function normalizeDateOverrides(
  overrides: TableBookingDateOverride[],
): TableBookingDateOverride[] {
  return [...overrides]
    .map((override) => ({
      ...override,
      periods: sortPeriods(override.periods ?? []),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function serializeComparableConfig(config: TableBookingPluginConfig): string {
  return JSON.stringify({
    ...config,
    sourceHosts: [...config.sourceHosts],
    redirectHostAllowlist: [...config.redirectHostAllowlist],
    notificationRecipientEmails: [...config.notificationRecipientEmails],
    weeklySchedule: normalizeWeeklySchedule(config.weeklySchedule ?? []),
    dateOverrides: normalizeDateOverrides(config.dateOverrides ?? []),
  });
}

function createDefaultPeriod(): TableBookingSchedulePeriod {
  return {
    startTime: "17:00",
    endTime: "21:00",
    slotIntervalMinutes: 30,
    maxConcurrentCovers: 28,
  };
}

function getWeeklyScheduleEntry(
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

function getDateOverride(
  dateOverrides: TableBookingDateOverride[],
  date: string,
): TableBookingDateOverride | null {
  return dateOverrides.find((override) => override.date === date) ?? null;
}

function resolveScheduleForDate(options: {
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

function setWeeklySchedulePeriods(options: {
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

function upsertDateOverride(options: {
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

function removeDateOverrideByDate(
  dateOverrides: TableBookingDateOverride[],
  date: string,
): TableBookingDateOverride[] {
  return normalizeDateOverrides(
    dateOverrides.filter((override) => override.date !== date),
  );
}

function buildDailyBookingSummary(
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

function formatScheduleSummary(
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

function formatDraftError(issue: {
  path: PropertyKey[];
  message: string;
}): string {
  if (issue.path.length === 0) return issue.message;
  return `${issue.path.map((part) => String(part)).join(".")}: ${issue.message}`;
}

function formatStatusLabel(status: TableBookingStatus): string {
  return STATUS_LABELS[status];
}

function formatSourceChannelLabel(sourceChannel: TableBookingSourceChannel): string {
  return SOURCE_CHANNEL_LABELS[sourceChannel];
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getCalendarDayTitle(schedule: {
  periods: TableBookingSchedulePeriod[];
  isClosed: boolean;
}): string {
  if (schedule.isClosed) return "Closed";
  if (schedule.periods.length === 1) {
    return `${schedule.periods[0]!.startTime} - ${schedule.periods[0]!.endTime}`;
  }
  return `${schedule.periods.length} service windows`;
}

function getCalendarDayCaption(schedule: {
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

function getBookingStatusBadgeVariant(
  status: TableBookingStatus,
): "success" | "destructive" | "secondary" | "outline" {
  if (status === "confirmed") return "success";
  if (status === "cancelled_by_guest" || status === "cancelled_by_staff") {
    return "destructive";
  }
  if (status === "no_show") return "secondary";
  return "outline";
}

function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note?: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-semibold tracking-tight">{value}</p>
        </div>
        <div className="rounded-md border bg-background p-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function SurfaceList({
  title,
  description,
  values,
  emptyCopy,
}: {
  title: string;
  description: string;
  values: string[];
  emptyCopy: string;
}) {
  const previewValues = values.slice(0, 6);
  const hiddenCount = Math.max(0, values.length - previewValues.length);

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {previewValues.map((value) => (
            <Badge
              key={`${title}-${value}`}
              variant="outline"
              className="max-w-full truncate bg-background"
              title={value}
            >
              {value}
            </Badge>
          ))}
          {hiddenCount > 0 ? (
            <Badge variant="secondary">+{hiddenCount} more</Badge>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyCopy}</p>
      )}
    </div>
  );
}

function SchedulePreview({
  periods,
  defaultDurationMinutes,
  emptyCopy,
}: {
  periods: TableBookingSchedulePeriod[];
  defaultDurationMinutes: number;
  emptyCopy: string;
}) {
  if (periods.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyCopy}</p>;
  }

  return (
    <div className="space-y-2">
      {periods.map((period, index) => (
        <div
          key={`${period.startTime}-${period.endTime}-${index}`}
          className="rounded-lg border bg-background px-3 py-2"
        >
          <p className="text-sm font-medium">
            {period.startTime} - {period.endTime}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatScheduleSummary(period, defaultDurationMinutes)}
          </p>
        </div>
      ))}
    </div>
  );
}

function PeriodEditor({
  period,
  defaultDurationMinutes,
  onChange,
  onRemove,
}: {
  period: TableBookingSchedulePeriod;
  defaultDurationMinutes: number;
  onChange: (next: TableBookingSchedulePeriod) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Start</Label>
          <Input
            type="time"
            value={period.startTime}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({ ...period, startTime: event.target.value })
            }
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">End</Label>
          <Input
            type="time"
            value={period.endTime}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({ ...period, endTime: event.target.value })
            }
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Slot every</Label>
          <Input
            type="number"
            min={5}
            max={180}
            value={period.slotIntervalMinutes}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({
                ...period,
                slotIntervalMinutes: Number.parseInt(event.target.value || "0", 10),
              })
            }
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Max covers</Label>
          <Input
            type="number"
            min={1}
            max={500}
            value={period.maxConcurrentCovers}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({
                ...period,
                maxConcurrentCovers: Number.parseInt(event.target.value || "0", 10),
              })
            }
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Stay length</Label>
          <Input
            type="number"
            min={30}
            max={480}
            placeholder={String(defaultDurationMinutes)}
            value={period.durationMinutes ?? ""}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({
                ...period,
                durationMinutes: event.target.value
                  ? Number.parseInt(event.target.value, 10)
                  : undefined,
              })
            }
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Max party</Label>
          <Input
            type="number"
            min={1}
            max={50}
            placeholder="No cap"
            value={period.maxPartySize ?? ""}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange({
                ...period,
                maxPartySize: event.target.value
                  ? Number.parseInt(event.target.value, 10)
                  : undefined,
              })
            }
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[28rem] text-xs leading-5 text-muted-foreground">
          {formatScheduleSummary(period, defaultDurationMinutes)}
        </p>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </Button>
      </div>
    </div>
  );
}

function BookingRow({
  booking,
  timeZone,
  actionPending,
  onEdit,
  onCancel,
  onMarkNoShow,
  onMarkCompleted,
}: {
  booking: TableBookingRecord;
  timeZone: string;
  actionPending: boolean;
  onEdit?: () => void;
  onCancel: () => void;
  onMarkNoShow: () => void;
  onMarkCompleted: () => void;
}) {
  const isCancelled =
    booking.status === "cancelled_by_guest" ||
    booking.status === "cancelled_by_staff";

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">
              {booking.guestName} · party of {booking.partySize}
            </p>
            <Badge variant={getBookingStatusBadgeVariant(booking.status)}>
              {formatStatusLabel(booking.status)}
            </Badge>
            <Badge variant="outline">
              {formatSourceChannelLabel(booking.sourceChannel)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(booking.serviceStartAt, timeZone)} to{" "}
            {formatTime(booking.serviceEndAt, timeZone)}
          </p>
          <p className="text-sm text-muted-foreground">
            {booking.guestEmail} · {booking.guestPhone}
          </p>
          {booking.notes ? (
            <p className="text-sm text-muted-foreground">Notes: {booking.notes}</p>
          ) : null}
          {booking.sourceHost ? (
            <p className="text-xs text-muted-foreground">
              Source: {booking.sourceHost}
              {booking.sourcePath ? booking.sourcePath : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {onEdit ? (
            <Button size="sm" variant="outline" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={actionPending || isCancelled}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={actionPending || isCancelled || booking.status === "no_show"}
            onClick={onMarkNoShow}
          >
            Mark no-show
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={actionPending || isCancelled || booking.status === "completed"}
            onClick={onMarkCompleted}
          >
            Mark completed
          </Button>
        </div>
      </div>
    </div>
  );
}

function CapacityWindowCard({
  window,
}: {
  window: TableBookingDayCapacityPayload["windows"][number];
}) {
  const ratio =
    window.effectiveCapacity > 0
      ? Math.min(100, Math.round((window.bookedCovers / window.effectiveCapacity) * 100))
      : 0;

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">
              {window.startTime} - {window.endTime}
            </p>
            {window.isClosed ? (
              <Badge variant="secondary">Closed</Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {window.bookedCovers} booked · {window.effectiveCapacity} effective ·{" "}
            {window.remainingCovers} remaining
          </p>
        </div>
        <div className="min-w-[7rem] text-right text-xs text-muted-foreground">
          Base {window.baseCapacity}
          <br />
          Every {window.slotIntervalMinutes} min
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
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
      {window.adjustments.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {window.adjustments.map((adjustment) => (
            <Badge key={adjustment.id} variant="outline" className="bg-card">
              {CAPACITY_MODE_LABELS[adjustment.mode]}
              {adjustment.capacityValue ? ` ${adjustment.capacityValue}` : ""}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SnippetCard({
  title,
  snippet,
  onCopy,
}: {
  title: string;
  snippet: string;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </Button>
      </div>
      <pre className="max-h-80 overflow-auto rounded-lg border bg-background p-3 text-xs whitespace-pre-wrap break-words">
        {snippet}
      </pre>
    </div>
  );
}

export default function TableBookingProjectPage({
  projectSlug,
  isEmbedded = false,
}: TableBookingProjectPageProps) {
  const { config } = useAppConfig();
  const utils = trpc.useUtils();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const canEnablePlugin = session?.user?.role === "super_admin";
  const canRequestPluginAccess =
    !isSessionPending && !canEnablePlugin && Boolean(config.supportEmail);
  const typedPluginId =
    "table_booking" as RouterOutputs["plugins"]["catalog"]["plugins"][number]["pluginId"];

  const [activeTab, setActiveTab] = useState<SettingsTab>("calendar");
  const [timezone, setTimezone] = useState("UTC");
  const [sourceHostsInput, setSourceHostsInput] = useState("");
  const [redirectHostsInput, setRedirectHostsInput] = useState("");
  const [notificationRecipientsInput, setNotificationRecipientsInput] = useState("");
  const [partyMin, setPartyMin] = useState("1");
  const [partyMax, setPartyMax] = useState("8");
  const [leadTimeMinutes, setLeadTimeMinutes] = useState("120");
  const [bookingHorizonDays, setBookingHorizonDays] = useState("60");
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState("90");
  const [cancellationCutoffMinutes, setCancellationCutoffMinutes] = useState("120");
  const [collectNotes, setCollectNotes] = useState(true);
  const [weeklySchedule, setWeeklySchedule] = useState<
    TableBookingWeeklyScheduleEntry[]
  >([]);
  const [dateOverrides, setDateOverrides] = useState<TableBookingDateOverride[]>(
    [],
  );
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [visibleMonth, setVisibleMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [bookingStatus, setBookingStatus] = useState<
    "all" | "confirmed" | "cancelled_by_guest" | "cancelled_by_staff" | "no_show" | "completed"
  >("all");
  const [bookingSourceChannel, setBookingSourceChannel] = useState<
    "all" | TableBookingSourceChannel
  >("all");
  const [bookingSearch, setBookingSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [bookingOffset, setBookingOffset] = useState(0);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [reservationDate, setReservationDate] = useState(selectedDate);
  const [reservationTime, setReservationTime] = useState("17:00");
  const [reservationPartySize, setReservationPartySize] = useState("2");
  const [reservationName, setReservationName] = useState("");
  const [reservationEmail, setReservationEmail] = useState("");
  const [reservationPhone, setReservationPhone] = useState("");
  const [reservationNotes, setReservationNotes] = useState("");
  const [reservationSourceChannel, setReservationSourceChannel] =
    useState<TableBookingSourceChannel>("phone");
  const [sendGuestNotification, setSendGuestNotification] = useState(false);
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<string | null>(null);
  const [adjustmentStartTime, setAdjustmentStartTime] = useState("17:00");
  const [adjustmentEndTime, setAdjustmentEndTime] = useState("19:00");
  const [adjustmentMode, setAdjustmentMode] =
    useState<TableBookingCapacityMode>("cover_holdback");
  const [adjustmentCapacityValue, setAdjustmentCapacityValue] = useState("4");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const limit = 100;

  const projectListQuery = trpc.project.list.useQuery(undefined, {
    enabled: !!projectSlug,
  });
  const pluginInfoQuery = trpc.plugins.info.useQuery(
    { slug: projectSlug, pluginId: typedPluginId },
    { enabled: !!projectSlug },
  );
  const pluginReadQueriesEnabled =
    !!projectSlug && pluginInfoQuery.data?.enabled === true;
  const monthRange = getMonthRange(visibleMonth);

  const summaryQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: TABLE_BOOKING_SUMMARY_READ_ID,
      input: { rangeDays: 7 },
    },
    {
      enabled: pluginReadQueriesEnabled,
      refetchOnWindowFocus: true,
      refetchInterval: pluginReadQueriesEnabled ? 30_000 : false,
    },
  );
  const monthBookingsQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: TABLE_BOOKING_BOOKINGS_READ_ID,
      input: {
        status: "all",
        search: "",
        startDate: monthRange.startDate,
        endDate: monthRange.endDate,
        limit: 200,
        offset: 0,
      },
    },
    {
      enabled: pluginReadQueriesEnabled,
      refetchOnWindowFocus: true,
      refetchInterval: pluginReadQueriesEnabled ? 30_000 : false,
    },
  );
  const selectedDateBookingsQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: TABLE_BOOKING_BOOKINGS_READ_ID,
      input: {
        status: "all",
        search: "",
        startDate: selectedDate,
        endDate: selectedDate,
        limit: 200,
        offset: 0,
      },
    },
    {
      enabled: pluginReadQueriesEnabled && Boolean(selectedDate),
      refetchOnWindowFocus: true,
      refetchInterval: pluginReadQueriesEnabled ? 30_000 : false,
    },
  );
  const dayCapacityQuery = trpc.plugins.tableBooking.dayCapacity.useQuery(
    {
      slug: projectSlug,
      serviceDate: selectedDate,
    },
    {
      enabled: pluginReadQueriesEnabled && Boolean(selectedDate),
      refetchOnWindowFocus: true,
      refetchInterval: pluginReadQueriesEnabled ? 30_000 : false,
    },
  );
  const bookingsQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: TABLE_BOOKING_BOOKINGS_READ_ID,
      input: {
        status: bookingStatus,
        sourceChannel: bookingSourceChannel,
        search: bookingSearch,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit,
        offset: bookingOffset,
      },
    },
    {
      enabled: pluginReadQueriesEnabled,
      refetchOnWindowFocus: true,
      refetchInterval: pluginReadQueriesEnabled ? 30_000 : false,
    },
  );

  const ensureMutation = trpc.plugins.ensure.useMutation({
    onSuccess: async () => {
      toast.success("Table Booking enabled");
      await Promise.all([
        utils.plugins.catalog.invalidate({ slug: projectSlug }),
        utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId }),
        utils.plugins.read.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error("Failed to enable Table Booking", {
        description: error.message,
      });
    },
  });

  const saveConfigMutation = trpc.plugins.updateConfig.useMutation({
    onSuccess: async () => {
      toast.success("Booking settings saved");
      await Promise.all([
        utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId }),
        utils.plugins.read.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error("Failed to save settings", {
        description: error.message,
      });
    },
  });

  const actionMutation = trpc.plugins.action.useMutation({
    onSuccess: async () => {
      toast.success("Booking updated");
      await Promise.all([
        utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId }),
        utils.plugins.read.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error("Booking action failed", {
        description: error.message,
      });
    },
  });

  const saveReservationMutation = trpc.plugins.tableBooking.saveReservation.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(
        variables.bookingId ? "Reservation updated" : "Reservation created",
      );
      setEditingBookingId(null);
      await Promise.all([
        utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId }),
        utils.plugins.read.invalidate(),
        utils.plugins.tableBooking.dayCapacity.invalidate({
          slug: projectSlug,
          serviceDate: variables.date,
        }),
      ]);
    },
    onError: (error) => {
      toast.error("Could not save reservation", {
        description: error.message,
      });
    },
  });

  const saveCapacityAdjustmentMutation =
    trpc.plugins.tableBooking.saveCapacityAdjustment.useMutation({
      onSuccess: async (_, variables) => {
        toast.success(
          variables.adjustmentId
            ? "Capacity adjustment updated"
            : "Capacity adjustment saved",
        );
        setEditingAdjustmentId(null);
        await Promise.all([
          utils.plugins.read.invalidate(),
          utils.plugins.tableBooking.dayCapacity.invalidate({
            slug: projectSlug,
            serviceDate: variables.serviceDate,
          }),
        ]);
      },
      onError: (error) => {
        toast.error("Could not save capacity adjustment", {
          description: error.message,
        });
      },
    });

  const deleteCapacityAdjustmentMutation =
    trpc.plugins.tableBooking.deleteCapacityAdjustment.useMutation({
      onSuccess: async () => {
        toast.success("Capacity adjustment removed");
        setEditingAdjustmentId(null);
        await Promise.all([
          utils.plugins.read.invalidate(),
          utils.plugins.tableBooking.dayCapacity.invalidate({
            slug: projectSlug,
            serviceDate: selectedDate,
          }),
        ]);
      },
      onError: (error) => {
        toast.error("Could not remove capacity adjustment", {
          description: error.message,
        });
      },
    });

  const exportBookingsMutation = trpc.plugins.tableBooking.exportBookings.useMutation({
    onSuccess: (result) => {
      downloadTextFile(result.filename, result.csv, "text/csv;charset=utf-8");
      toast.success(`Exported ${result.total} bookings`);
    },
    onError: (error) => {
      toast.error("Could not export bookings", {
        description: error.message,
      });
    },
  });

  const pluginInfo = pluginInfoQuery.data as
    | (RouterOutputs["plugins"]["info"] & {
        config: TableBookingPluginConfig | null;
        snippets: {
          html: string;
          astro: string;
        } | null;
        usage: {
          availabilityEndpoint: string;
          bookEndpoint: string;
          cancelEndpoint: string;
          expectedFields: string[];
          optionalFields: string[];
          inferredAutoSourceHosts: string[];
        } | null;
        details: {
          counts?: {
            bookingsToday: number;
            upcomingBookings: number;
            upcomingCovers: number;
          };
          notificationRecipients?: string[];
        } | null;
      })
    | undefined;
  const summary = summaryQuery.data?.result as TableBookingSummaryPayload | undefined;
  const monthBookings = monthBookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;
  const selectedDayBookings = selectedDateBookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;
  const dayCapacity = dayCapacityQuery.data as TableBookingDayCapacityPayload | undefined;
  const bookings = bookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;

  useEffect(() => {
    if (!pluginInfo?.config) return;

    setTimezone(pluginInfo.config.timezone);
    setSourceHostsInput(formatListInput(pluginInfo.config.sourceHosts ?? []));
    setRedirectHostsInput(
      formatListInput(pluginInfo.config.redirectHostAllowlist ?? []),
    );
    setNotificationRecipientsInput(
      formatListInput(pluginInfo.config.notificationRecipientEmails ?? []),
    );
    setPartyMin(String(pluginInfo.config.partySize?.min ?? 1));
    setPartyMax(String(pluginInfo.config.partySize?.max ?? 8));
    setLeadTimeMinutes(String(pluginInfo.config.leadTimeMinutes ?? 120));
    setBookingHorizonDays(String(pluginInfo.config.bookingHorizonDays ?? 60));
    setDefaultDurationMinutes(
      String(pluginInfo.config.defaultDurationMinutes ?? 90),
    );
    setCancellationCutoffMinutes(
      String(pluginInfo.config.cancellationCutoffMinutes ?? 120),
    );
    setCollectNotes(Boolean(pluginInfo.config.collectNotes));
    setWeeklySchedule(
      normalizeWeeklySchedule(pluginInfo.config.weeklySchedule ?? []),
    );
    setDateOverrides(
      normalizeDateOverrides(pluginInfo.config.dateOverrides ?? []),
    );
  }, [pluginInfo?.config]);

  const projectTitle =
    projectListQuery.data?.projects?.find((project) => project.slug === projectSlug)
      ?.title ?? projectSlug;

  useEffect(() => {
    if (!projectSlug) return;
    document.title = formatDocumentTitle(`${projectTitle} Table Booking`);
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [projectSlug, projectTitle]);

  useEffect(() => {
    setBookingOffset(0);
  }, [bookingStatus, bookingSourceChannel, bookingSearch, startDate, endDate]);

  useEffect(() => {
    setReservationDate(selectedDate);
    setEditingAdjustmentId(null);
    if (!editingBookingId) {
      setReservationTime("17:00");
    }
  }, [selectedDate, editingBookingId]);

  const pluginEnabled = !!pluginInfo?.enabled;
  const needsEnable =
    (pluginInfo?.entitled ?? false) && !pluginEnabled && !pluginInfo?.instanceId;
  const pluginPresentation = getProjectPluginPresentation(typedPluginId, projectSlug);
  const PluginIcon = pluginPresentation.icon;
  const requestAccessMutation = trpc.plugins.requestAccess.useMutation({
    onSuccess: async () => {
      toast.success("Access request sent");
      await pluginInfoQuery.refetch();
    },
    onError: (error) => {
      toast.error("Failed to send access request", {
        description: error.message,
      });
    },
  });
  const isRequestPending = isPluginAccessRequestPending(pluginInfo?.accessRequest);
  const isRefreshing =
    pluginInfoQuery.isFetching ||
    summaryQuery.isFetching ||
    monthBookingsQuery.isFetching ||
    dayCapacityQuery.isFetching ||
    selectedDateBookingsQuery.isFetching ||
    bookingsQuery.isFetching;
  const todayInTimezone = getTodayIsoDate(timezone);
  const calendarDays = buildMonthGrid(visibleMonth);
  const monthBookingSummary = buildDailyBookingSummary(monthBookings?.rows ?? []);
  const selectedSchedule = resolveScheduleForDate({
    weeklySchedule,
    dateOverrides,
    date: selectedDate,
  });
  const selectedBaseEntry = getWeeklyScheduleEntry(
    weeklySchedule,
    selectedSchedule.dayOfWeek,
  );
  const selectedOverride = getDateOverride(dateOverrides, selectedDate);
  const selectedDaySummary = monthBookingSummary.get(selectedDate);
  const selectedDayRows = selectedDayBookings?.rows ?? [];
  const selectedDayCapacityWindows = dayCapacity?.windows ?? [];
  const selectedDayAdjustments = dayCapacity?.adjustments ?? [];
  const selectedDayCountLabel = selectedDaySummary
    ? `${selectedDaySummary.count} bookings · ${selectedDaySummary.covers} covers`
    : "No bookings yet";
  const monthlyOverflowCount =
    (monthBookings?.total ?? 0) - (monthBookings?.rows.length ?? 0);

  const buildDraftConfig = (): TableBookingPluginConfig => ({
    timezone,
    sourceHosts: parseListInput(sourceHostsInput),
    redirectHostAllowlist: parseListInput(redirectHostsInput),
    notificationRecipientEmails: parseListInput(notificationRecipientsInput),
    partySize: {
      min: Number.parseInt(partyMin || "0", 10),
      max: Number.parseInt(partyMax || "0", 10),
    },
    leadTimeMinutes: Number.parseInt(leadTimeMinutes || "0", 10),
    bookingHorizonDays: Number.parseInt(bookingHorizonDays || "0", 10),
    defaultDurationMinutes: Number.parseInt(defaultDurationMinutes || "0", 10),
    cancellationCutoffMinutes: Number.parseInt(
      cancellationCutoffMinutes || "0",
      10,
    ),
    collectNotes,
    weeklySchedule: normalizeWeeklySchedule(weeklySchedule),
    dateOverrides: normalizeDateOverrides(dateOverrides),
  });

  const draftConfigResult = tableBookingPluginConfigSchema.safeParse(
    buildDraftConfig(),
  );
  const hasUnsavedChanges = pluginInfo?.config
    ? !draftConfigResult.success ||
      serializeComparableConfig(draftConfigResult.data) !==
        serializeComparableConfig(pluginInfo.config)
    : false;

  const handleSaveConfig = () => {
    const result = tableBookingPluginConfigSchema.safeParse(buildDraftConfig());
    if (!result.success) {
      toast.error("Please fix the booking setup", {
        description: formatDraftError(result.error.issues[0]!),
      });
      return;
    }

    saveConfigMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      config: result.data,
    });
  };

  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard;

  const copyText = async (value: string, label: string) => {
    if (!canCopy) {
      toast.error("Clipboard is not available");
      return;
    }
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  const resetReservationEditor = (date = selectedDate) => {
    setEditingBookingId(null);
    setReservationDate(date);
    setReservationTime("17:00");
    setReservationPartySize("2");
    setReservationName("");
    setReservationEmail("");
    setReservationPhone("");
    setReservationNotes("");
    setReservationSourceChannel("phone");
    setSendGuestNotification(false);
  };

  const startEditingReservation = (booking: TableBookingRecord) => {
    setEditingBookingId(booking.id);
    setReservationDate(booking.serviceDate);
    setReservationTime(formatTimeInputValue(booking.serviceStartAt, timezone));
    setReservationPartySize(String(booking.partySize));
    setReservationName(booking.guestName);
    setReservationEmail(booking.guestEmail);
    setReservationPhone(booking.guestPhone);
    setReservationNotes(booking.notes ?? "");
    setReservationSourceChannel(booking.sourceChannel);
    setSendGuestNotification(false);
    setSelectedDate(booking.serviceDate);
    setVisibleMonth(booking.serviceDate.slice(0, 7));
    setActiveTab("calendar");
  };

  const resetCapacityAdjustmentForm = (date = selectedDate) => {
    const scheduleForDate = resolveScheduleForDate({
      weeklySchedule,
      dateOverrides,
      date,
    });
    const firstPeriod = scheduleForDate.periods[0];
    setEditingAdjustmentId(null);
    setAdjustmentStartTime(firstPeriod?.startTime ?? "17:00");
    setAdjustmentEndTime(firstPeriod?.endTime ?? "19:00");
    setAdjustmentMode("cover_holdback");
    setAdjustmentCapacityValue("4");
    setAdjustmentReason("");
  };

  const startEditingCapacityAdjustment = (
    adjustment: TableBookingCapacityAdjustmentRecord,
  ) => {
    setEditingAdjustmentId(adjustment.id);
    setAdjustmentStartTime(adjustment.startTime);
    setAdjustmentEndTime(adjustment.endTime);
    setAdjustmentMode(adjustment.mode);
    setAdjustmentCapacityValue(
      adjustment.capacityValue ? String(adjustment.capacityValue) : "",
    );
    setAdjustmentReason(adjustment.reason ?? "");
  };

  useEffect(() => {
    if (!editingAdjustmentId) {
      resetCapacityAdjustmentForm(selectedDate);
    }
  }, [selectedDate, editingAdjustmentId, weeklySchedule, dateOverrides]);

  const updateWeeklyPeriod = (
    dayOfWeek: number,
    index: number,
    nextPeriod: TableBookingSchedulePeriod,
  ) => {
    setWeeklySchedule((current) => {
      const entry = getWeeklyScheduleEntry(current, dayOfWeek);
      const nextPeriods = entry.periods.map((period, periodIndex) =>
        periodIndex === index ? nextPeriod : period,
      );
      return setWeeklySchedulePeriods({
        weeklySchedule: current,
        dayOfWeek,
        periods: nextPeriods,
      });
    });
  };

  const addWeeklyPeriod = (dayOfWeek: number) => {
    setWeeklySchedule((current) => {
      const entry = getWeeklyScheduleEntry(current, dayOfWeek);
      return setWeeklySchedulePeriods({
        weeklySchedule: current,
        dayOfWeek,
        periods: [...entry.periods, createDefaultPeriod()],
      });
    });
  };

  const removeWeeklyPeriod = (dayOfWeek: number, index: number) => {
    setWeeklySchedule((current) => {
      const entry = getWeeklyScheduleEntry(current, dayOfWeek);
      return setWeeklySchedulePeriods({
        weeklySchedule: current,
        dayOfWeek,
        periods: entry.periods.filter((_, periodIndex) => periodIndex !== index),
      });
    });
  };

  const createOverrideFromBase = (date: string) => {
    const dayOfWeek = getWeekdayFromIsoDate(date);
    const basePeriods = getWeeklyScheduleEntry(weeklySchedule, dayOfWeek).periods;

    setDateOverrides((current) =>
      upsertDateOverride({
        dateOverrides: current,
        override: {
          date,
          closed: false,
          periods:
            basePeriods.length > 0
              ? sortPeriods(basePeriods)
              : [createDefaultPeriod()],
        },
      }),
    );
  };

  const markOverrideClosed = (date: string) => {
    setDateOverrides((current) =>
      upsertDateOverride({
        dateOverrides: current,
        override: {
          date,
          closed: true,
        },
      }),
    );
  };

  const clearOverride = (date: string) => {
    setDateOverrides((current) => removeDateOverrideByDate(current, date));
  };

  const updateOverridePeriod = (
    date: string,
    index: number,
    nextPeriod: TableBookingSchedulePeriod,
  ) => {
    setDateOverrides((current) => {
      const override = getDateOverride(current, date) ?? {
        date,
        closed: false,
        periods: [createDefaultPeriod()],
      };
      const nextPeriods = (override.periods ?? []).map((period, periodIndex) =>
        periodIndex === index ? nextPeriod : period,
      );
      return upsertDateOverride({
        dateOverrides: current,
        override: {
          ...override,
          closed: false,
          periods: nextPeriods,
        },
      });
    });
  };

  const addOverridePeriod = (date: string) => {
    setDateOverrides((current) => {
      const override = getDateOverride(current, date) ?? {
        date,
        closed: false,
        periods: [],
      };
      return upsertDateOverride({
        dateOverrides: current,
        override: {
          ...override,
          closed: false,
          periods: [...(override.periods ?? []), createDefaultPeriod()],
        },
      });
    });
  };

  const removeOverridePeriod = (date: string, index: number) => {
    setDateOverrides((current) => {
      const override = getDateOverride(current, date);
      if (!override) return current;

      const nextPeriods = (override.periods ?? []).filter(
        (_, periodIndex) => periodIndex !== index,
      );

      return upsertDateOverride({
        dateOverrides: current,
        override:
          nextPeriods.length > 0
            ? {
                ...override,
                closed: false,
                periods: nextPeriods,
              }
            : {
                date,
                closed: true,
              },
      });
    });
  };

  const saveReservation = () => {
    saveReservationMutation.mutate({
      slug: projectSlug,
      bookingId: editingBookingId ?? undefined,
      date: reservationDate,
      time: reservationTime,
      partySize: Number.parseInt(reservationPartySize || "0", 10),
      name: reservationName.trim(),
      email: reservationEmail.trim(),
      phone: reservationPhone.trim(),
      notes: reservationNotes.trim() || null,
      sourceChannel: reservationSourceChannel,
      sendGuestNotification,
    });
  };

  const saveCapacityAdjustment = () => {
    saveCapacityAdjustmentMutation.mutate({
      slug: projectSlug,
      adjustmentId: editingAdjustmentId ?? undefined,
      serviceDate: selectedDate,
      startTime: adjustmentStartTime,
      endTime: adjustmentEndTime,
      mode: adjustmentMode,
      capacityValue:
        adjustmentMode === "closed"
          ? null
          : Number.parseInt(adjustmentCapacityValue || "0", 10),
      reason: adjustmentReason.trim() || null,
    });
  };

  const exportBookings = () => {
    exportBookingsMutation.mutate({
      slug: projectSlug,
      status: bookingStatus,
      sourceChannel: bookingSourceChannel,
      search: bookingSearch,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });
  };

  const runBookingAction = (actionId: string, bookingId: string) => {
    actionMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId,
      args: [bookingId],
    });
  };

  const bookingsRows = bookings?.rows ?? [];
  const bookingRangeStart = bookings && bookings.total > 0 ? bookingOffset + 1 : 0;
  const bookingRangeEnd = bookings
    ? Math.min(bookingOffset + bookingsRows.length, bookings.total)
    : 0;
  const canLoadPreviousBookings = bookingOffset > 0;
  const canLoadMoreBookings = bookingRangeEnd < (bookings?.total ?? 0);
  const readErrors = [
    summaryQuery.error ? `Summary: ${summaryQuery.error.message}` : null,
    monthBookingsQuery.error ? `Calendar: ${monthBookingsQuery.error.message}` : null,
    dayCapacityQuery.error ? `Capacity: ${dayCapacityQuery.error.message}` : null,
    selectedDateBookingsQuery.error
      ? `Selected day: ${selectedDateBookingsQuery.error.message}`
      : null,
    bookingsQuery.error ? `Booking search: ${bookingsQuery.error.message}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <SettingsPageShell
      title="Table Booking"
      description="Operate bookings from a calendar-first view, then adjust hours and widget settings without dropping into raw config."
      className={isEmbedded ? "mx-auto w-full max-w-7xl px-4 py-4 sm:px-6" : undefined}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isEmbedded ? (
            <Button variant="outline" asChild>
              <Link to={ROUTES.PROJECT_PLUGINS(projectSlug)}>Back to plugins</Link>
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([
                pluginInfoQuery.refetch(),
                summaryQuery.refetch(),
                monthBookingsQuery.refetch(),
                dayCapacityQuery.refetch(),
                selectedDateBookingsQuery.refetch(),
                bookingsQuery.refetch(),
              ]);
            }}
            disabled={isRefreshing}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {pluginEnabled ? (
            <>
              {hasUnsavedChanges ? (
                <Badge variant="secondary">Unsaved changes</Badge>
              ) : null}
              <Button
                onClick={handleSaveConfig}
                disabled={
                  saveConfigMutation.isPending ||
                  !pluginEnabled ||
                  !hasUnsavedChanges
                }
              >
                {saveConfigMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save settings"
                )}
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      <div className={isEmbedded ? "mx-auto max-w-7xl space-y-5" : "space-y-5"}>
        <section className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
                  <PluginIcon className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-semibold">Project: {projectTitle}</h2>
                <Badge variant={pluginEnabled ? "success" : "outline"}>
                  {pluginEnabled
                    ? "Enabled"
                    : pluginInfo?.entitled
                      ? "Available"
                      : "Disabled"}
                </Badge>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">
                {pluginEnabled
                  ? "Use the calendar to see service windows, date overrides, and live bookings in one place."
                  : pluginInfo?.entitled
                    ? isSessionPending
                      ? "Table Booking is available for this project, but it still needs to be enabled before guests can book."
                      : canEnablePlugin
                      ? "Table Booking is available for this project, but it still needs to be enabled before guests can book."
                      : "Table Booking is available for this project, but a super-admin still needs to enable it."
                    : "Table Booking access is managed from the admin plugin settings."}
              </p>
            </div>
            {!pluginEnabled && needsEnable && canEnablePlugin ? (
              <Button
                variant="outline"
                onClick={() =>
                  ensureMutation.mutate({
                    slug: projectSlug,
                    pluginId: typedPluginId,
                  })
                }
                disabled={ensureMutation.isPending}
              >
                {ensureMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enabling...
                  </>
                ) : (
                  "Enable for this project"
                )}
              </Button>
            ) : !pluginEnabled && canRequestPluginAccess ? (
              <Button
                variant="outline"
                onClick={() =>
                  requestAccessMutation.mutate({
                    slug: projectSlug,
                    pluginId: typedPluginId,
                  })
                }
                disabled={isRequestPending || requestAccessMutation.isPending}
              >
                {requestAccessMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  getPluginAccessRequestLabel(pluginInfo?.accessRequest)
                )}
              </Button>
            ) : null}
          </div>
          {pluginInfoQuery.error ? (
            <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load plugin info: {pluginInfoQuery.error.message}
            </div>
          ) : null}
        </section>

        {pluginEnabled ? (
          <>
            {readErrors.length > 0 ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Some booking data could not load. {readErrors.join(" ")}
              </div>
            ) : null}

            <section className="grid gap-4 lg:grid-cols-3">
              <MetricCard
                label="Bookings today"
                value={String(summary?.counts.bookingsToday ?? 0)}
                note={`${summary?.counts.coversToday ?? 0} covers today`}
                icon={CalendarDays}
              />
              <MetricCard
                label="Upcoming"
                value={String(summary?.counts.upcomingBookings ?? 0)}
                note={`${summary?.counts.upcomingCovers ?? 0} covers in the pipeline`}
                icon={Users}
              />
              <MetricCard
                label="Recent issues"
                value={String(
                  (summary?.counts.cancelled ?? 0) + (summary?.counts.noShow ?? 0),
                )}
                note={`${summary?.counts.cancelled ?? 0} cancelled · ${summary?.counts.noShow ?? 0} no-show`}
                icon={BellRing}
              />
            </section>

            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as SettingsTab)}
            >
              <TabsList className="grid h-auto w-full grid-cols-2 rounded-lg bg-muted p-1 md:grid-cols-4">
                <TabsTrigger value="calendar" className="px-3 py-2">
                  Calendar
                </TabsTrigger>
                <TabsTrigger value="bookings" className="px-3 py-2">
                  Booking search
                </TabsTrigger>
                <TabsTrigger value="setup" className="px-3 py-2">
                  Setup
                </TabsTrigger>
                <TabsTrigger value="install" className="px-3 py-2">
                  Install
                </TabsTrigger>
              </TabsList>

              <TabsContent value="calendar" className="space-y-5">
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
                            weeklySchedule,
                            dateOverrides,
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
                                day.inMonth &&
                                  schedule.hasOverride &&
                                  "bg-amber-500/[0.05]",
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
                          <Badge
                            variant={selectedSchedule.isClosed ? "secondary" : "success"}
                          >
                            {selectedSchedule.isClosed ? "Closed" : "Open"}
                          </Badge>
                          <Badge variant="outline">
                            {selectedSchedule.hasOverride
                              ? "Date override"
                              : "Weekly hours"}
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
                                defaultDurationMinutes={Number.parseInt(
                                  defaultDurationMinutes || "90",
                                  10,
                                )}
                                emptyCopy="No weekly service windows are set for this weekday."
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => createOverrideFromBase(selectedDate)}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add custom hours
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => markOverrideClosed(selectedDate)}
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
                                onClick={() => clearOverride(selectedDate)}
                              >
                                Use weekly hours
                              </Button>
                              {selectedOverride.closed ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => createOverrideFromBase(selectedDate)}
                                >
                                  Add custom hours
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => markOverrideClosed(selectedDate)}
                                >
                                  Mark closed
                                </Button>
                              )}
                            </div>

                            {selectedOverride.closed ? (
                              <div className="rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                                This date is explicitly closed, even if the weekly
                                schedule would normally accept bookings.
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {(selectedOverride.periods ?? []).map(
                                  (period, index) => (
                                    <PeriodEditor
                                      key={`${selectedDate}-${index}`}
                                      period={period}
                                      defaultDurationMinutes={Number.parseInt(
                                        defaultDurationMinutes || "90",
                                        10,
                                      )}
                                      onChange={(next) =>
                                        updateOverridePeriod(selectedDate, index, next)
                                      }
                                      onRemove={() =>
                                        removeOverridePeriod(selectedDate, index)
                                      }
                                    />
                                  ),
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => addOverridePeriod(selectedDate)}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Add service window
                                </Button>
                              </div>
                            )}

                            <div className="rounded-lg border bg-muted/20 p-3">
                              <p className="text-sm font-medium">
                                Weekly baseline for{" "}
                                {WEEKDAY_LABELS[selectedSchedule.dayOfWeek]}
                              </p>
                              <div className="mt-2">
                                <SchedulePreview
                                  periods={selectedBaseEntry.periods}
                                  defaultDurationMinutes={Number.parseInt(
                                    defaultDurationMinutes || "90",
                                    10,
                                  )}
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
                          onClick={() => resetReservationEditor(selectedDate)}
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
                              actionPending={
                                actionMutation.isPending ||
                                saveReservationMutation.isPending
                              }
                              onEdit={() => startEditingReservation(booking)}
                              onCancel={() =>
                                runBookingAction("cancel_booking", booking.id)
                              }
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
                        editingBookingId
                          ? "Reservation editor"
                          : "Operator reservation"
                      }
                      description={
                        editingBookingId
                          ? "Update or move a booking without leaving the selected day."
                          : "Capture phone, walk-in, or staff-managed reservations so capacity stays accurate."
                      }
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Date</Label>
                          <Input
                            type="date"
                            value={reservationDate}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setReservationDate(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Time</Label>
                          <Input
                            type="time"
                            value={reservationTime}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setReservationTime(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Party size</Label>
                          <Input
                            type="number"
                            min={1}
                            max={50}
                            value={reservationPartySize}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setReservationPartySize(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Source</Label>
                          <Select
                            value={reservationSourceChannel}
                            onValueChange={(value) =>
                              setReservationSourceChannel(
                                value as TableBookingSourceChannel,
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="phone">Phone</SelectItem>
                              <SelectItem value="walk_in">Walk-in</SelectItem>
                              <SelectItem value="staff_manual">Staff</SelectItem>
                              <SelectItem value="online">Online</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Guest name</Label>
                          <Input
                            value={reservationName}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setReservationName(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            value={reservationEmail}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setReservationEmail(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Phone</Label>
                          <Input
                            value={reservationPhone}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setReservationPhone(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Notes</Label>
                          <Textarea
                            rows={3}
                            value={reservationNotes}
                            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                              setReservationNotes(event.target.value)
                            }
                            placeholder="Dietary requests or service notes"
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={sendGuestNotification}
                          onCheckedChange={(value) =>
                            setSendGuestNotification(Boolean(value))
                          }
                        />
                        Send guest confirmation email after save
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={saveReservation}
                          disabled={saveReservationMutation.isPending}
                        >
                          {saveReservationMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Saving...
                            </>
                          ) : editingBookingId ? (
                            "Update reservation"
                          ) : (
                            "Create reservation"
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => resetReservationEditor(selectedDate)}
                          disabled={saveReservationMutation.isPending}
                        >
                          {editingBookingId ? "Stop editing" : "Reset"}
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
                                    startEditingCapacityAdjustment(adjustment)
                                  }
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    deleteCapacityAdjustmentMutation.mutate({
                                      slug: projectSlug,
                                      adjustmentId: adjustment.id,
                                    })
                                  }
                                  disabled={deleteCapacityAdjustmentMutation.isPending}
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
                            value={adjustmentStartTime}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setAdjustmentStartTime(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>End</Label>
                          <Input
                            type="time"
                            value={adjustmentEndTime}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setAdjustmentEndTime(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Mode</Label>
                          <Select
                            value={adjustmentMode}
                            onValueChange={(value) =>
                              setAdjustmentMode(value as TableBookingCapacityMode)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cover_holdback">
                                Cover holdback
                              </SelectItem>
                              <SelectItem value="effective_capacity_override">
                                Effective capacity
                              </SelectItem>
                              <SelectItem value="closed">Closed window</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>
                            {adjustmentMode === "effective_capacity_override"
                              ? "Effective capacity"
                              : "Covers"}
                          </Label>
                          <Input
                            type="number"
                            min={1}
                            value={adjustmentCapacityValue}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setAdjustmentCapacityValue(event.target.value)
                            }
                            disabled={adjustmentMode === "closed"}
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Reason</Label>
                          <Input
                            value={adjustmentReason}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setAdjustmentReason(event.target.value)
                            }
                            placeholder="Staff shortage, private event, walk-in holdback"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={saveCapacityAdjustment}
                          disabled={saveCapacityAdjustmentMutation.isPending}
                        >
                          {saveCapacityAdjustmentMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Saving...
                            </>
                          ) : editingAdjustmentId ? (
                            "Update adjustment"
                          ) : (
                            "Add adjustment"
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => resetCapacityAdjustmentForm(selectedDate)}
                          disabled={saveCapacityAdjustmentMutation.isPending}
                        >
                          {editingAdjustmentId ? "Stop editing" : "Reset"}
                        </Button>
                      </div>
                    </SectionCard>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="bookings" className="space-y-5">
                <SectionCard
                  title="Booking search"
                  description="Search across bookings when you need more than the calendar day view."
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select
                        value={bookingStatus}
                        onValueChange={(value) => setBookingStatus(value as typeof bookingStatus)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="confirmed">Confirmed</SelectItem>
                          <SelectItem value="cancelled_by_guest">
                            Cancelled by guest
                          </SelectItem>
                          <SelectItem value="cancelled_by_staff">
                            Cancelled by staff
                          </SelectItem>
                          <SelectItem value="no_show">No-show</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Source</Label>
                      <Select
                        value={bookingSourceChannel}
                        onValueChange={(value) =>
                          setBookingSourceChannel(
                            value as typeof bookingSourceChannel,
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="online">Online</SelectItem>
                          <SelectItem value="phone">Phone</SelectItem>
                          <SelectItem value="walk_in">Walk-in</SelectItem>
                          <SelectItem value="staff_manual">Staff</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Search</Label>
                      <Input
                        value={bookingSearch}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setBookingSearch(event.target.value)
                        }
                        placeholder="Name, email, phone"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Start date</Label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setStartDate(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>End date</Label>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setEndDate(event.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                      {bookings?.total
                        ? `Showing ${bookingRangeStart}-${bookingRangeEnd} of ${bookings.total} bookings`
                        : "No bookings found"}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={exportBookingsMutation.isPending}
                        onClick={exportBookings}
                      >
                        {exportBookingsMutation.isPending ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Exporting...
                          </>
                        ) : (
                          "Export CSV"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canLoadPreviousBookings}
                        onClick={() =>
                          setBookingOffset((current) => Math.max(0, current - limit))
                        }
                      >
                        Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canLoadMoreBookings}
                        onClick={() => setBookingOffset((current) => current + limit)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>

                  {bookingsQuery.isLoading && !bookings ? (
                    <p className="text-sm text-muted-foreground">Loading bookings...</p>
                  ) : null}
                  {bookingsQuery.error ? (
                    <p className="text-sm text-destructive">
                      Could not load bookings: {bookingsQuery.error.message}
                    </p>
                  ) : null}
                  {!bookingsQuery.isLoading &&
                  !bookingsQuery.error &&
                  bookingsRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No bookings match the current filters.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {bookingsRows.map((booking) => (
                        <BookingRow
                          key={booking.id}
                          booking={booking}
                          timeZone={timezone}
                          actionPending={
                            actionMutation.isPending ||
                            saveReservationMutation.isPending
                          }
                          onEdit={() => startEditingReservation(booking)}
                          onCancel={() =>
                            runBookingAction("cancel_booking", booking.id)
                          }
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
              </TabsContent>

              <TabsContent value="setup" className="space-y-5">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.95fr)]">
                  <SectionCard
                    title="Weekly hours"
                    description="These are the default service windows guests see unless you add a date-specific override."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      {WEEKDAY_ORDER.map((dayOfWeek) => {
                        const entry = getWeeklyScheduleEntry(weeklySchedule, dayOfWeek);
                        return (
                          <div
                            key={dayOfWeek}
                            className="rounded-lg border bg-background p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium">
                                  {WEEKDAY_LABELS[dayOfWeek]}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {entry.periods.length > 0
                                    ? `${entry.periods.length} service window${entry.periods.length === 1 ? "" : "s"}`
                                    : "Closed by default"}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => addWeeklyPeriod(dayOfWeek)}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add window
                              </Button>
                            </div>
                            <div className="mt-3 space-y-3">
                              {entry.periods.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No service windows. Guests can only book this day if
                                  you add hours here or create a date override.
                                </p>
                              ) : (
                                entry.periods.map((period, index) => (
                                  <PeriodEditor
                                    key={`${dayOfWeek}-${index}`}
                                    period={period}
                                    defaultDurationMinutes={Number.parseInt(
                                      defaultDurationMinutes || "90",
                                      10,
                                    )}
                                    onChange={(next) =>
                                      updateWeeklyPeriod(dayOfWeek, index, next)
                                    }
                                    onRemove={() =>
                                      removeWeeklyPeriod(dayOfWeek, index)
                                    }
                                  />
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>

                  <div className="space-y-5">
                    <SectionCard
                      title="Reservation rules"
                      description="These defaults apply across the widget and capacity checks."
                    >
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label>Timezone</Label>
                          <Input
                            value={timezone}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              setTimezone(event.target.value)
                            }
                            placeholder="Europe/Berlin"
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Min party size</Label>
                            <Input
                              type="number"
                              min={1}
                              max={20}
                              value={partyMin}
                              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                setPartyMin(event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Max party size</Label>
                            <Input
                              type="number"
                              min={1}
                              max={20}
                              value={partyMax}
                              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                setPartyMax(event.target.value)
                              }
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Lead time (minutes)</Label>
                            <Input
                              type="number"
                              min={0}
                              value={leadTimeMinutes}
                              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                setLeadTimeMinutes(event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Booking horizon (days)</Label>
                            <Input
                              type="number"
                              min={1}
                              value={bookingHorizonDays}
                              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                setBookingHorizonDays(event.target.value)
                              }
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Default stay length (minutes)</Label>
                            <Input
                              type="number"
                              min={30}
                              value={defaultDurationMinutes}
                              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                setDefaultDurationMinutes(event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Cancellation cutoff (minutes)</Label>
                            <Input
                              type="number"
                              min={0}
                              value={cancellationCutoffMinutes}
                              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                setCancellationCutoffMinutes(event.target.value)
                              }
                            />
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={collectNotes}
                            onCheckedChange={(value) => setCollectNotes(Boolean(value))}
                          />
                          Collect guest notes
                        </label>
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Notification and embed controls"
                      description="These lists still map directly to the plugin config, but they are grouped by outcome instead of raw JSON."
                    >
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label>Notification recipient emails</Label>
                          <Textarea
                            value={notificationRecipientsInput}
                            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                              setNotificationRecipientsInput(event.target.value)
                            }
                            rows={4}
                            placeholder="reservations@example.com"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Source hosts</Label>
                          <Textarea
                            value={sourceHostsInput}
                            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                              setSourceHostsInput(event.target.value)
                            }
                            rows={4}
                            placeholder="example.com"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Redirect allowlist</Label>
                          <Textarea
                            value={redirectHostsInput}
                            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                              setRedirectHostsInput(event.target.value)
                            }
                            rows={4}
                            placeholder="example.com"
                          />
                        </div>
                        {pluginInfo?.usage ? (
                          <SurfaceList
                            title="Auto-detected source hosts"
                            description="Hosts the widget has already seen from generated snippets or live usage."
                            values={pluginInfo.usage.inferredAutoSourceHosts ?? []}
                            emptyCopy="No auto-detected hosts yet."
                          />
                        ) : null}
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Saved date overrides"
                      description="Use the calendar for editing. This list gives you a quick audit trail of special openings and closures."
                    >
                      {dateOverrides.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No date overrides yet.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {dateOverrides.map((override) => (
                            <div
                              key={override.date}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-3 py-3"
                            >
                              <div className="space-y-1">
                                <button
                                  type="button"
                                  className="text-left text-sm font-medium hover:underline"
                                  onClick={() => {
                                    setSelectedDate(override.date);
                                    setVisibleMonth(override.date.slice(0, 7));
                                    setActiveTab("calendar");
                                  }}
                                >
                                  {formatLongDate(override.date, timezone)}
                                </button>
                                <p className="text-xs text-muted-foreground">
                                  {override.closed
                                    ? "Closed"
                                    : `${(override.periods ?? []).length} custom service window${(override.periods ?? []).length === 1 ? "" : "s"}`}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={override.closed ? "secondary" : "outline"}
                                >
                                  {override.closed ? "Closed" : "Custom hours"}
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => clearOverride(override.date)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Remove
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </SectionCard>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="install" className="space-y-5">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                  <div className="space-y-5">
                    <SectionCard
                      title="Widget endpoints"
                      description="These are the live endpoints the generated widget calls."
                    >
                      {pluginInfo?.usage ? (
                        <div className="space-y-3">
                          <div className="rounded-lg border bg-background px-3 py-3 text-xs">
                            <p className="font-medium text-muted-foreground">
                              Availability
                            </p>
                            <p className="mt-1 break-all font-mono">
                              {pluginInfo.usage.availabilityEndpoint}
                            </p>
                          </div>
                          <div className="rounded-lg border bg-background px-3 py-3 text-xs">
                            <p className="font-medium text-muted-foreground">Book</p>
                            <p className="mt-1 break-all font-mono">
                              {pluginInfo.usage.bookEndpoint}
                            </p>
                          </div>
                          <div className="rounded-lg border bg-background px-3 py-3 text-xs">
                            <p className="font-medium text-muted-foreground">
                              Cancel
                            </p>
                            <p className="mt-1 break-all font-mono">
                              {pluginInfo.usage.cancelEndpoint}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Enable the plugin for this project to see the live widget
                          endpoints.
                        </p>
                      )}
                    </SectionCard>

                    <SectionCard
                      title="Form contract"
                      description="Expected and optional fields for custom widget integrations."
                    >
                      {pluginInfo?.usage ? (
                        <div className="space-y-4">
                          <SurfaceList
                            title="Required fields"
                            description="These fields are expected in booking submissions."
                            values={pluginInfo.usage.expectedFields ?? []}
                            emptyCopy="No required fields listed."
                          />
                          <SurfaceList
                            title="Optional fields"
                            description="These fields can be sent when available."
                            values={pluginInfo.usage.optionalFields ?? []}
                            emptyCopy="No optional fields listed."
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Enable the plugin to inspect the widget field contract.
                        </p>
                      )}
                    </SectionCard>
                  </div>

                  <SectionCard
                    title="Generated snippets"
                    description="Use these instead of rebuilding the widget contract by hand."
                  >
                    {pluginInfo?.snippets ? (
                      <div className="space-y-6">
                        <SnippetCard
                          title="HTML"
                          snippet={pluginInfo.snippets.html}
                          onCopy={() =>
                            void copyText(
                              pluginInfo.snippets?.html || "",
                              "HTML snippet",
                            )
                          }
                        />
                        <SnippetCard
                          title="Astro"
                          snippet={pluginInfo.snippets.astro}
                          onCopy={() =>
                            void copyText(
                              pluginInfo.snippets?.astro || "",
                              "Astro snippet",
                            )
                          }
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Enable the plugin for this project to generate install
                        snippets.
                      </p>
                    )}
                  </SectionCard>
                </div>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <SectionCard
            title="What will unlock after enablement"
            description="The redesigned screen is ready, but the project still needs an enabled plugin instance before it can load schedules, live bookings, and snippets."
          >
            <div className="grid gap-4 md:grid-cols-3">
              <MetricCard
                label="Calendar workspace"
                value="Month view"
                note="Weekly hours, overrides, and booking volume in one calendar."
                icon={CalendarDays}
              />
              <MetricCard
                label="Booking search"
                value="Live actions"
                note="Cancel, mark no-show, and complete reservations from one list."
                icon={NotebookPen}
              />
              <MetricCard
                label="Setup"
                value="Typed editors"
                note="Weekly hours and date overrides without touching raw JSON."
                icon={Settings2}
              />
            </div>
          </SectionCard>
        )}
      </div>
    </SettingsPageShell>
  );
}
