import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  Clock,
  Contrast,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, cn } from "@vivd/ui";
import { ROUTES, trpc } from "@/plugins/host";
import { ReservationSheet } from "./tableBookingProjectPage/calendarSheets";
import { CapacityWindowCard } from "./tableBookingProjectPage/shared";
import { PLUGIN_READ_REFETCH_INTERVAL_MS } from "./tableBookingProjectPage/constants";
import {
  TABLE_BOOKING_DAY_CAPACITY_READ_ID,
  TABLE_BOOKING_BOOKINGS_READ_ID,
  TABLE_BOOKING_SUMMARY_READ_ID,
} from "../shared/summary";
import { TABLE_BOOKING_SAVE_RESERVATION_ACTION_ID } from "../shared/operatorActions";
import {
  formatLongDate,
  formatTime,
  formatTimeFromMinutes,
  getTodayIsoDate,
  parseTimeToMinutes,
  resolveScheduleForDate,
  validateReservationDraft,
} from "./tableBookingProjectPage/utils";
import type {
  TableBookingBookingsPayload,
  TableBookingDayCapacityPayload,
  TableBookingPluginInfo,
  TableBookingRecord,
  TableBookingSummaryPayload,
} from "./tableBookingProjectPage/types";
import { useTableBookingConfigDraft } from "./tableBookingProjectPage/useConfigDraft";
import { useTableBookingReservationEditor } from "./tableBookingProjectPage/useReservationEditor";
import {
  PRESENTATION_MODE_LABELS,
  usePresentationMode,
  type PresentationMode,
} from "./tableBookingOperatorPage/presentationMode";
import { useScreenWakeLock } from "./tableBookingOperatorPage/useWakeLock";
import { useFreshness } from "./tableBookingOperatorPage/useFreshness";
import { useNewArrivals } from "./tableBookingOperatorPage/useNewArrivals";
import { OPERATOR_STYLES } from "./tableBookingOperatorPage/styles";

interface TableBookingOperatorPageProps {
  projectSlug: string;
}

const UNDO_DURATION_MS = 8_000;

export default function TableBookingOperatorPage({
  projectSlug,
}: TableBookingOperatorPageProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { mode, cycleMode } = usePresentationMode();
  const wakeLockStatus = useScreenWakeLock(true);
  const [wakeNoticeDismissed, setWakeNoticeDismissed] = useState(false);
  const [reservationSheetOpen, setReservationSheetOpen] = useState(false);

  const pluginInfoQuery = trpc.plugins.info.useQuery(
    { slug: projectSlug, pluginId: "table_booking" },
    { refetchOnWindowFocus: true },
  );
  const projectListQuery = trpc.project.list.useQuery(undefined);
  const pluginInfo = pluginInfoQuery.data as TableBookingPluginInfo | undefined;
  const pluginEnabled = Boolean(pluginInfo?.enabled);
  const projectTitle =
    projectListQuery.data?.projects?.find(
      (project) => project.slug === projectSlug,
    )?.title ?? projectSlug;
  const draft = useTableBookingConfigDraft(pluginInfo?.config);
  const timezone = draft.timezone;
  const today = useMemo(() => getTodayIsoDate(timezone), [timezone]);

  const summaryQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: "table_booking",
      readId: TABLE_BOOKING_SUMMARY_READ_ID,
      input: { rangeDays: 7 },
    },
    {
      enabled: pluginEnabled,
      refetchOnWindowFocus: true,
      refetchInterval: pluginEnabled ? PLUGIN_READ_REFETCH_INTERVAL_MS : false,
    },
  );
  const todayBookingsQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: "table_booking",
      readId: TABLE_BOOKING_BOOKINGS_READ_ID,
      input: {
        status: "all",
        search: "",
        startDate: today,
        endDate: today,
        limit: 200,
        offset: 0,
      },
    },
    {
      enabled: pluginEnabled && Boolean(today),
      refetchOnWindowFocus: true,
      refetchInterval: pluginEnabled ? PLUGIN_READ_REFETCH_INTERVAL_MS : false,
    },
  );
  const dayCapacityQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: "table_booking",
      readId: TABLE_BOOKING_DAY_CAPACITY_READ_ID,
      input: {
        serviceDate: today,
      },
    },
    {
      enabled: pluginEnabled && Boolean(today),
      refetchOnWindowFocus: true,
      refetchInterval: pluginEnabled ? PLUGIN_READ_REFETCH_INTERVAL_MS : false,
    },
  );

  const saveReservationMutation = trpc.plugins.action.useMutation({
    onSuccess: async (_, variables) => {
      const reservationInput = variables.input;
      if (!reservationInput) {
        return;
      }
      toast.success(
        reservationInput.bookingId
          ? "Reservation updated"
          : "Reservation created",
      );
      setReservationSheetOpen(false);
      reservationEditor.resetReservationEditor(String(reservationInput.date));
      await Promise.all([utils.plugins.read.invalidate()]);
    },
    onError: (error) => {
      toast.error("Could not save reservation", {
        description: error.message,
      });
    },
  });

  const actionMutation = trpc.plugins.action.useMutation({
    onSuccess: async () => {
      await utils.plugins.read.invalidate();
    },
    onError: (error) => {
      toast.error("Booking action failed", { description: error.message });
    },
  });

  const reservationEditor = useTableBookingReservationEditor({
    selectedDate: today,
    timezone,
    setSelectedDate: () => {},
    setVisibleMonth: () => {},
    setActiveTab: () => {},
  });

  const summary = summaryQuery.data?.result as
    | TableBookingSummaryPayload
    | undefined;
  const todayBookings = todayBookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;
  const dayCapacity = dayCapacityQuery.data?.result as
    | TableBookingDayCapacityPayload
    | undefined;

  const lastSuccessRef = useRef<number | null>(null);
  const isFetching =
    summaryQuery.isFetching ||
    todayBookingsQuery.isFetching ||
    dayCapacityQuery.isFetching;
  const hasReadError = Boolean(
    summaryQuery.error || todayBookingsQuery.error || dayCapacityQuery.error,
  );
  useEffect(() => {
    if (!isFetching && !hasReadError) {
      lastSuccessRef.current = Date.now();
    }
  }, [isFetching, hasReadError]);

  const freshness = useFreshness(
    lastSuccessRef.current,
    PLUGIN_READ_REFETCH_INTERVAL_MS,
    hasReadError,
  );

  const todayRows = todayBookings?.rows ?? [];
  const upcomingArrivals = useMemo(() => {
    return [...todayRows]
      .filter((row) => row.status === "confirmed")
      .sort((a, b) => a.serviceStartAt.localeCompare(b.serviceStartAt));
  }, [todayRows]);

  const { newCount, newIds, acknowledge } = useNewArrivals(upcomingArrivals);

  const schedule = useMemo(
    () =>
      resolveScheduleForDate({
        weeklySchedule: draft.weeklySchedule,
        dateOverrides: draft.dateOverrides,
        date: today,
      }),
    [draft.weeklySchedule, draft.dateOverrides, today],
  );

  const nowMinutes = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number.parseInt(
      parts.find((part) => part.type === "hour")?.value ?? "0",
      10,
    );
    const minute = Number.parseInt(
      parts.find((part) => part.type === "minute")?.value ?? "0",
      10,
    );
    return hour * 60 + minute;
  }, [timezone, freshness.ageSeconds]);

  const nextAvailableTime = useMemo(() => {
    const periods = schedule.periods;
    if (periods.length === 0) return "17:00";
    for (const period of periods) {
      const start = parseTimeToMinutes(period.startTime);
      const end = parseTimeToMinutes(period.endTime);
      const interval = Math.max(5, period.slotIntervalMinutes || 30);
      if (nowMinutes < start) return period.startTime;
      if (nowMinutes < end) {
        const next = Math.min(
          end - interval,
          start + Math.ceil((nowMinutes - start) / interval) * interval,
        );
        return formatTimeFromMinutes(Math.max(start, next));
      }
    }
    return periods[0]!.startTime;
  }, [schedule.periods, nowMinutes]);

  const currentWindow = useMemo(() => {
    if (!dayCapacity) return null;
    return (
      dayCapacity.windows.find((window) => {
        const start = parseTimeToMinutes(window.startTime);
        const end = parseTimeToMinutes(window.endTime);
        return nowMinutes >= start && nowMinutes < end;
      }) ?? null
    );
  }, [dayCapacity, nowMinutes]);

  const nextWindow = useMemo(() => {
    if (!dayCapacity) return null;
    return (
      dayCapacity.windows.find(
        (window) => parseTimeToMinutes(window.startTime) > nowMinutes,
      ) ?? null
    );
  }, [dayCapacity, nowMinutes]);

  const openQuickAdd = () => {
    reservationEditor.resetReservationEditor(today);
    reservationEditor.setReservationDate(today);
    reservationEditor.setReservationTime(nextAvailableTime);
    reservationEditor.setReservationPartySize("2");
    reservationEditor.setReservationSourceChannel("phone");
    reservationEditor.setSendGuestNotification(false);
    setReservationSheetOpen(true);
  };

  const saveReservation = () => {
    const validation = validateReservationDraft({
      date: reservationEditor.reservationDate,
      time: reservationEditor.reservationTime,
      partySize: reservationEditor.reservationPartySize,
      name: reservationEditor.reservationName,
      email: reservationEditor.reservationEmail,
      phone: reservationEditor.reservationPhone,
      sendGuestNotification: reservationEditor.sendGuestNotification,
    });
    if (Object.keys(validation.errors).length > 0) {
      reservationEditor.setReservationErrors(validation.errors);
      return;
    }

    reservationEditor.clearReservationErrors();
    saveReservationMutation.mutate({
      slug: projectSlug,
      pluginId: "table_booking",
      actionId: TABLE_BOOKING_SAVE_RESERVATION_ACTION_ID,
      input: {
        bookingId: reservationEditor.editingBookingId ?? undefined,
        date: reservationEditor.reservationDate,
        time: reservationEditor.reservationTime,
        partySize: validation.partySize,
        name: reservationEditor.reservationName.trim(),
        email: reservationEditor.reservationEmail.trim(),
        phone: reservationEditor.reservationPhone.trim(),
        notes: reservationEditor.reservationNotes.trim() || null,
        sourceChannel: reservationEditor.reservationSourceChannel,
        sendGuestNotification: reservationEditor.sendGuestNotification,
      },
    });
  };

  const runBookingAction = (
    actionId: "cancel_booking" | "mark_no_show" | "mark_completed",
    booking: TableBookingRecord,
    actionLabel: string,
  ) => {
    const priorStatus = booking.status;
    actionMutation.mutate(
      {
        slug: projectSlug,
        pluginId: "table_booking",
        actionId,
        args: [booking.id],
      },
      {
        onSuccess: () => {
          toast(`${actionLabel} · ${booking.guestName || "Guest"}`, {
            duration: UNDO_DURATION_MS,
            action:
              priorStatus === "confirmed"
                ? {
                    label: "Undo",
                    onClick: () => {
                      toast.message("Undo is not yet supported", {
                        description:
                          "Re-open the reservation from the bookings list to restore status.",
                      });
                    },
                  }
                : undefined,
          });
        },
      },
    );
  };

  const manualRefresh = () => {
    void summaryQuery.refetch();
    void todayBookingsQuery.refetch();
    void dayCapacityQuery.refetch();
  };

  const handleClose = () => {
    navigate(ROUTES.PROJECT_PLUGIN(projectSlug, "table_booking"));
  };

  const showDegradedBanner = hasReadError || freshness.tone === "stale";

  const isHc = mode === "hc-light" || mode === "hc-dark";
  const surfaceClass = isHc ? "op-surface" : "border bg-surface-panel";
  const raisedClass = isHc ? "op-surface-raised" : "border bg-surface-sunken";
  const mutedClass = isHc ? "op-muted" : "text-muted-foreground";
  const subtleClass = isHc ? "op-subtle" : "text-muted-foreground";

  return (
    <div
      data-tb-operator-mode={mode}
      className="flex min-h-dvh w-screen flex-col bg-background text-foreground"
      style={{ minHeight: "100dvh" }}
    >
      <style dangerouslySetInnerHTML={{ __html: OPERATOR_STYLES }} />
      <OperatorHeader
        projectTitle={projectTitle}
        todayLabel={formatLongDate(today, timezone)}
        summary={summary}
        freshness={freshness}
        onRefresh={manualRefresh}
        refreshing={isFetching}
        onCycleMode={cycleMode}
        mode={mode}
        onClose={handleClose}
        onQuickAdd={pluginEnabled ? openQuickAdd : undefined}
        isHc={isHc}
      />

      {!pluginEnabled ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div className={cn("max-w-md rounded-xl p-6", surfaceClass)}>
            <p className="text-lg font-semibold">Service mode is unavailable</p>
            <p className={cn("mt-2 text-sm", mutedClass)}>
              Enable Table Booking for this project before opening the service
              board.
            </p>
            <Button className="mt-4" onClick={handleClose}>
              Back to settings
            </Button>
          </div>
        </div>
      ) : (
        <>
          {showDegradedBanner ? (
            <div
              className={cn(
                "mx-3 mt-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium md:mx-5",
                isHc
                  ? "op-pill op-pill-danger"
                  : "border-destructive/50 bg-destructive/10 text-destructive",
              )}
            >
              <WifiOff className="h-4 w-4" />
              <span>
                Live data may be stale. Last successful update {freshness.label}
                .
              </span>
              <Button
                size="sm"
                variant="outline"
                className={cn("ml-auto", isHc && "op-btn")}
                onClick={manualRefresh}
              >
                Refresh
              </Button>
            </div>
          ) : null}

          {wakeLockStatus === "failed" && !wakeNoticeDismissed ? (
            <div
              className={cn(
                "mx-3 mt-2 flex items-center gap-2 rounded-md border px-3 py-2 text-xs md:mx-5",
                isHc
                  ? "op-pill op-pill-warn"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
              )}
            >
              <ShieldAlert className="h-4 w-4" />
              <span>
                Couldn't keep the screen awake — the tablet may sleep during
                service.
              </span>
              <button
                type="button"
                className="ml-auto underline"
                onClick={() => setWakeNoticeDismissed(true)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <main className="grid flex-1 min-h-0 grid-cols-1 gap-3 p-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-5 md:p-5">
            <section
              className={cn(
                "flex min-h-0 flex-col gap-3 rounded-xl p-4 md:p-5",
                surfaceClass,
              )}
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    Service board
                  </h2>
                  <p className={cn("text-sm", mutedClass)}>
                    {schedule.isClosed
                      ? "Closed today"
                      : `${dayCapacity?.windows.length ?? 0} service windows`}
                  </p>
                </div>
                {currentWindow ? (
                  <Badge
                    className={cn(
                      "px-3 py-1 text-sm",
                      isHc ? "op-pill op-pill-ok" : "",
                    )}
                  >
                    Now · {currentWindow.startTime}–{currentWindow.endTime}
                  </Badge>
                ) : nextWindow ? (
                  <Badge
                    variant="outline"
                    className={cn("px-3 py-1 text-sm", isHc ? "op-pill" : "")}
                  >
                    Next · {nextWindow.startTime}
                  </Badge>
                ) : null}
              </header>

              <CoversHeadline
                summary={summary}
                currentWindow={currentWindow}
                nextWindow={nextWindow}
                isHc={isHc}
                mutedClass={mutedClass}
                raisedClass={raisedClass}
              />

              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                {dayCapacity?.windows.length ? (
                  dayCapacity.windows.map((window) => (
                    <CapacityWindowCard key={window.key} window={window} />
                  ))
                ) : (
                  <p className={cn("text-sm", mutedClass)}>
                    {schedule.isClosed
                      ? "No service windows today."
                      : "Loading service windows…"}
                  </p>
                )}
              </div>
            </section>

            <section
              className={cn(
                "flex min-h-0 flex-col gap-3 rounded-xl p-4 md:p-5",
                surfaceClass,
              )}
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    Upcoming arrivals
                  </h2>
                  <p className={cn("text-sm", mutedClass)}>
                    {upcomingArrivals.length} confirmed today
                  </p>
                </div>
                {newCount > 0 ? (
                  <button
                    type="button"
                    onClick={acknowledge}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold",
                      isHc
                        ? "op-pill op-pill-ok"
                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {newCount} new
                  </button>
                ) : null}
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {upcomingArrivals.length === 0 ? (
                  <p className={cn("text-sm", mutedClass)}>
                    No confirmed arrivals yet today. Use{" "}
                    <span className="font-medium">Add reservation</span> to
                    capture a phone or walk-in booking.
                  </p>
                ) : (
                  upcomingArrivals.map((booking) => (
                    <ArrivalRow
                      key={booking.id}
                      booking={booking}
                      timezone={timezone}
                      highlighted={newIds.has(booking.id)}
                      nowMinutes={nowMinutes}
                      isHc={isHc}
                      raisedClass={raisedClass}
                      subtleClass={subtleClass}
                      onCancel={() =>
                        runBookingAction("cancel_booking", booking, "Cancelled")
                      }
                      onNoShow={() =>
                        runBookingAction(
                          "mark_no_show",
                          booking,
                          "Marked no-show",
                        )
                      }
                      onCompleted={() =>
                        runBookingAction(
                          "mark_completed",
                          booking,
                          "Marked completed",
                        )
                      }
                      onEdit={() => {
                        reservationEditor.startEditingReservation(booking);
                        setReservationSheetOpen(true);
                      }}
                      actionPending={actionMutation.isPending}
                    />
                  ))
                )}
              </div>
            </section>
          </main>

          <ReservationSheet
            open={reservationSheetOpen}
            onOpenChange={setReservationSheetOpen}
            editor={reservationEditor}
            selectedDate={today}
            timezone={timezone}
            presentationMode={mode}
            onSave={saveReservation}
            pending={saveReservationMutation.isPending}
          />
        </>
      )}
    </div>
  );
}

function OperatorHeader({
  projectTitle,
  todayLabel,
  summary,
  freshness,
  onRefresh,
  refreshing,
  onCycleMode,
  mode,
  onClose,
  onQuickAdd,
  isHc,
}: {
  projectTitle: string;
  todayLabel: string;
  summary: TableBookingSummaryPayload | undefined;
  freshness: ReturnType<typeof useFreshness>;
  onRefresh: () => void;
  refreshing: boolean;
  onCycleMode: () => void;
  mode: PresentationMode;
  onClose: () => void;
  onQuickAdd?: () => void;
  isHc: boolean;
}) {
  const toneClass =
    freshness.tone === "fresh"
      ? "op-freshness-fresh"
      : freshness.tone === "warm"
        ? "op-freshness-warm"
        : "op-freshness-stale";

  return (
    <header
      className={cn(
        "flex flex-wrap items-center gap-3 border-b px-3 py-3 md:px-5",
        isHc ? "op-surface" : "bg-surface-panel",
      )}
    >
      <button
        type="button"
        onClick={onClose}
        className={cn(
          "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
          isHc && "op-btn",
        )}
        aria-label="Close service mode"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Settings</span>
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold leading-tight md:text-lg">
          {projectTitle}
        </p>
        <p className="truncate text-xs text-muted-foreground md:text-sm">
          Service mode · {todayLabel}
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs md:text-sm">
        <span className="hidden items-center gap-1 rounded-md border px-2 py-1 md:inline-flex">
          <Bell className="h-3.5 w-3.5" />
          {summary?.counts.coversToday ?? 0} covers
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 tabular-nums",
            isHc && "op-pill",
          )}
          title={`Last successful update ${freshness.label}`}
        >
          <span
            className={cn("op-freshness-dot", toneClass)}
            aria-hidden="true"
          />
          <Clock className="h-3.5 w-3.5" />
          {freshness.label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          className={cn(isHc && "op-btn")}
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          <span className="hidden md:inline">Refresh</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCycleMode}
          className={cn(isHc && "op-btn")}
          title="Cycle presentation mode"
        >
          <Contrast className="h-4 w-4" />
          <span className="hidden md:inline">
            {PRESENTATION_MODE_LABELS[mode]}
          </span>
        </Button>
        {onQuickAdd ? (
          <Button
            size="sm"
            onClick={onQuickAdd}
            className={cn(isHc && "op-btn op-btn-primary")}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add reservation</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function CoversHeadline({
  summary,
  currentWindow,
  nextWindow,
  isHc,
  mutedClass,
  raisedClass,
}: {
  summary: TableBookingSummaryPayload | undefined;
  currentWindow: TableBookingDayCapacityPayload["windows"][number] | null;
  nextWindow: TableBookingDayCapacityPayload["windows"][number] | null;
  isHc: boolean;
  mutedClass: string;
  raisedClass: string;
}) {
  const focused = currentWindow ?? nextWindow;
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatTile
        label={
          currentWindow
            ? "Remaining now"
            : nextWindow
              ? "Remaining next"
              : "Covers today"
        }
        value={String(
          focused?.remainingCovers ?? summary?.counts.coversToday ?? 0,
        )}
        note={
          focused
            ? `${focused.bookedCovers} of ${focused.effectiveCapacity}`
            : `${summary?.counts.bookingsToday ?? 0} bookings`
        }
        isHc={isHc}
        mutedClass={mutedClass}
        raisedClass={raisedClass}
      />
      <StatTile
        label="Booked today"
        value={String(summary?.counts.coversToday ?? 0)}
        note={`${summary?.counts.bookingsToday ?? 0} reservations`}
        isHc={isHc}
        mutedClass={mutedClass}
        raisedClass={raisedClass}
      />
      <StatTile
        label="Issues"
        value={String(
          (summary?.counts.cancelled ?? 0) + (summary?.counts.noShow ?? 0),
        )}
        note={`${summary?.counts.cancelled ?? 0} cancel · ${summary?.counts.noShow ?? 0} no-show`}
        isHc={isHc}
        mutedClass={mutedClass}
        raisedClass={raisedClass}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  note,
  isHc,
  mutedClass,
  raisedClass,
}: {
  label: string;
  value: string;
  note: string;
  isHc: boolean;
  mutedClass: string;
  raisedClass: string;
}) {
  return (
    <div className={cn("rounded-lg p-3", raisedClass)}>
      <p className={cn("text-xs uppercase tracking-wide", mutedClass)}>
        {label}
      </p>
      <p
        className={cn(
          "tabular-nums font-semibold leading-tight",
          isHc ? "text-4xl" : "text-3xl",
        )}
      >
        {value}
      </p>
      <p className={cn("mt-0.5 text-xs", mutedClass)}>{note}</p>
    </div>
  );
}

function ArrivalRow({
  booking,
  timezone,
  highlighted,
  nowMinutes,
  isHc,
  raisedClass,
  subtleClass,
  onCancel,
  onNoShow,
  onCompleted,
  onEdit,
  actionPending,
}: {
  booking: TableBookingRecord;
  timezone: string;
  highlighted: boolean;
  nowMinutes: number;
  isHc: boolean;
  raisedClass: string;
  subtleClass: string;
  onCancel: () => void;
  onNoShow: () => void;
  onCompleted: () => void;
  onEdit: () => void;
  actionPending: boolean;
}) {
  const startLabel = formatTime(booking.serviceStartAt, timezone);
  const endLabel = formatTime(booking.serviceEndAt, timezone);
  const startParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(booking.serviceStartAt));
  const startMinutes =
    Number.parseInt(
      startParts.find((part) => part.type === "hour")?.value ?? "0",
      10,
    ) *
      60 +
    Number.parseInt(
      startParts.find((part) => part.type === "minute")?.value ?? "0",
      10,
    );
  const minutesUntil = startMinutes - nowMinutes;
  const isPast = minutesUntil < -5;
  const isImminent = minutesUntil >= -5 && minutesUntil <= 20;

  return (
    <div
      className={cn(
        "rounded-lg p-3 md:p-4",
        raisedClass,
        highlighted && "op-row-new",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-[5rem] tabular-nums leading-tight">
          <p
            className={cn(
              "font-semibold",
              isHc ? "text-2xl" : "text-xl",
              isPast && "line-through opacity-70",
            )}
          >
            {startLabel}
          </p>
          <p className={cn("text-xs", subtleClass)}>{endLabel}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                "truncate font-semibold",
                isHc ? "text-lg" : "text-base",
              )}
            >
              {booking.guestName || "Guest"}
            </p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                isHc ? "op-pill" : "bg-surface-sunken",
              )}
            >
              {booking.partySize}p
            </span>
            {isImminent && !isPast ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  isHc
                    ? "op-pill op-pill-warn"
                    : "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                )}
              >
                {minutesUntil <= 0 ? "Now" : `${minutesUntil} min`}
              </span>
            ) : null}
          </div>
          <p className={cn("truncate text-sm", subtleClass)}>
            {booking.guestPhone || booking.guestEmail || "No contact"}
            {booking.notes ? ` · ${booking.notes}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className={cn(isHc && "op-btn")}
          onClick={onEdit}
          disabled={actionPending}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={cn(isHc && "op-btn")}
          onClick={onCompleted}
          disabled={actionPending || booking.status === "completed"}
        >
          Seated / done
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={cn(isHc && "op-btn")}
          onClick={onNoShow}
          disabled={actionPending || booking.status === "no_show"}
        >
          No-show
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className={cn(isHc && "op-btn op-btn-danger")}
          onClick={onCancel}
          disabled={
            actionPending ||
            booking.status === "cancelled_by_staff" ||
            booking.status === "cancelled_by_guest"
          }
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
