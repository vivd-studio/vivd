import type { ChangeEvent, ComponentType, ReactNode } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  formatCapacityModeLabel,
  formatDateTime,
  formatScheduleSummary,
  formatSourceChannelLabel,
  formatStatusLabel,
  formatTime,
  getBookingStatusBadgeVariant,
} from "./utils";
import type {
  TableBookingDayCapacityPayload,
  TableBookingRecord,
  TableBookingSchedulePeriod,
} from "./types";

export function SectionCard({
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

export function MetricCard({
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

export function SurfaceList({
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

export function SchedulePreview({
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

export function PeriodEditor({
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

export function BookingRow({
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

export function CapacityWindowCard({
  window,
}: {
  window: TableBookingDayCapacityPayload["windows"][number];
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
              {formatCapacityModeLabel(adjustment.mode)}
              {adjustment.capacityValue ? ` ${adjustment.capacityValue}` : ""}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SnippetCard({
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
