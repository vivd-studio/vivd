import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BellRing,
  CalendarDays,
  Loader2,
  Monitor,
  NotebookPen,
  Settings2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/plugins/host";
import { SettingsPageShell } from "@/plugins/host";
import {
  Badge,
  Button,
  Callout,
  CalloutDescription,
  Panel,
  Separator,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@vivd/ui";
import { trpc } from "@/plugins/host";
import {
  ProjectPluginAccessActions,
  ProjectPluginPageActions,
  useProjectPluginPageModel,
} from "@/plugins/host";
import { tableBookingPluginConfigSchema } from "../backend/config";
import {
  TABLE_BOOKING_DAY_CAPACITY_READ_ID,
  TABLE_BOOKING_BOOKINGS_READ_ID,
  TABLE_BOOKING_SUMMARY_READ_ID,
} from "../shared/summary";
import {
  TABLE_BOOKING_DELETE_CAPACITY_ADJUSTMENT_ACTION_ID,
  TABLE_BOOKING_EXPORT_BOOKINGS_ACTION_ID,
  TABLE_BOOKING_SAVE_CAPACITY_ADJUSTMENT_ACTION_ID,
  TABLE_BOOKING_SAVE_RESERVATION_ACTION_ID,
} from "../shared/operatorActions";
import { PLUGIN_READ_REFETCH_INTERVAL_MS } from "./tableBookingProjectPage/constants";
import { TableBookingBookingsTab } from "./tableBookingProjectPage/BookingsTab";
import { TableBookingCalendarTab } from "./tableBookingProjectPage/CalendarTab";
import { TableBookingInstallTab } from "./tableBookingProjectPage/InstallTab";
import {
  MetricCard,
  SectionCard,
  StatInline,
} from "./tableBookingProjectPage/shared";
import { TableBookingSetupTab } from "./tableBookingProjectPage/SetupTab";
import type {
  SettingsTab,
  TableBookingBookingsPayload,
  TableBookingDayCapacityPayload,
  TableBookingPluginInfo,
  TableBookingProjectPageProps,
  TableBookingSourceChannel,
  TableBookingStatus,
  TableBookingSummaryPayload,
} from "./tableBookingProjectPage/types";
import {
  downloadTextFile,
  formatDraftError,
  getMonthRange,
  serializeComparableConfig,
  validateReservationDraft,
} from "./tableBookingProjectPage/utils";
import { useTableBookingCapacityAdjustmentEditor } from "./tableBookingProjectPage/useCapacityAdjustmentEditor";
import { useTableBookingConfigDraft } from "./tableBookingProjectPage/useConfigDraft";
import { useTableBookingReservationEditor } from "./tableBookingProjectPage/useReservationEditor";

export default function TableBookingProjectPage({
  projectSlug,
  isEmbedded = false,
}: TableBookingProjectPageProps) {
  const {
    utils,
    isSessionPending,
    typedPluginId,
    pluginInfo: rawPluginInfo,
    pluginInfoQuery,
    projectTitle,
    PluginIcon,
    canEnablePlugin,
    canRequestPluginAccess,
    pluginEnabled,
    needsEnable,
    isRequestPending,
    requestAccessLabel,
    ensureMutation,
    requestAccessMutation,
    invalidatePluginPage,
    refreshPluginPage,
  } = useProjectPluginPageModel({
    projectSlug,
    pluginId: "table_booking",
    isEmbedded,
    documentTitle: ({ projectTitle }) => `${projectTitle} Table Booking`,
    enableToast: {
      success: "Table Booking enabled",
      error: "Failed to enable Table Booking",
    },
    requestAccessToast: {
      success: "Access request sent",
      error: "Failed to send access request",
    },
    invalidateOnEnable: ({ utils }) => [() => utils.plugins.read.invalidate()],
  });

  const [activeTab, setActiveTab] = useState<SettingsTab>("calendar");
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [visibleMonth, setVisibleMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [reservationSheetOpen, setReservationSheetOpen] = useState(false);
  const [capacitySheetOpen, setCapacitySheetOpen] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<
    "all" | TableBookingStatus
  >("all");
  const [bookingSourceChannel, setBookingSourceChannel] = useState<
    "all" | TableBookingSourceChannel
  >("all");
  const [bookingSearch, setBookingSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [bookingOffset, setBookingOffset] = useState(0);
  const limit = 100;

  const pluginReadQueriesEnabled = !!projectSlug && pluginEnabled;
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
      refetchInterval: pluginReadQueriesEnabled
        ? PLUGIN_READ_REFETCH_INTERVAL_MS
        : false,
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
      refetchInterval: pluginReadQueriesEnabled
        ? PLUGIN_READ_REFETCH_INTERVAL_MS
        : false,
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
      refetchInterval: pluginReadQueriesEnabled
        ? PLUGIN_READ_REFETCH_INTERVAL_MS
        : false,
    },
  );
  const dayCapacityQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: TABLE_BOOKING_DAY_CAPACITY_READ_ID,
      input: {
        serviceDate: selectedDate,
      },
    },
    {
      enabled: pluginReadQueriesEnabled && Boolean(selectedDate),
      refetchOnWindowFocus: true,
      refetchInterval: pluginReadQueriesEnabled
        ? PLUGIN_READ_REFETCH_INTERVAL_MS
        : false,
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
      refetchInterval: pluginReadQueriesEnabled
        ? PLUGIN_READ_REFETCH_INTERVAL_MS
        : false,
    },
  );

  const saveConfigMutation = trpc.plugins.updateConfig.useMutation({
    onSuccess: async () => {
      toast.success("Booking settings saved");
      await invalidatePluginPage([() => utils.plugins.read.invalidate()]);
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
      await invalidatePluginPage([() => utils.plugins.read.invalidate()]);
    },
    onError: (error) => {
      toast.error("Booking action failed", {
        description: error.message,
      });
    },
  });

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
      await invalidatePluginPage([() => utils.plugins.read.invalidate()]);
    },
    onError: (error) => {
      toast.error("Could not save reservation", {
        description: error.message,
      });
    },
  });

  const saveCapacityAdjustmentMutation = trpc.plugins.action.useMutation({
    onSuccess: async (_, variables) => {
      const adjustmentInput = variables.input;
      if (!adjustmentInput) {
        return;
      }
      toast.success(
        adjustmentInput.adjustmentId
          ? "Capacity adjustment updated"
          : "Capacity adjustment saved",
      );
      capacityEditor.resetCapacityAdjustmentForm(
        String(adjustmentInput.serviceDate),
      );
      await Promise.all([utils.plugins.read.invalidate()]);
    },
    onError: (error) => {
      toast.error("Could not save capacity adjustment", {
        description: error.message,
      });
    },
  });

  const deleteCapacityAdjustmentMutation = trpc.plugins.action.useMutation({
    onSuccess: async () => {
      toast.success("Capacity adjustment removed");
      capacityEditor.resetCapacityAdjustmentForm(selectedDate);
      await Promise.all([utils.plugins.read.invalidate()]);
    },
    onError: (error) => {
      toast.error("Could not remove capacity adjustment", {
        description: error.message,
      });
    },
  });

  const exportBookingsMutation = trpc.plugins.action.useMutation({
    onSuccess: (result) => {
      const exportResult = result.result as {
        filename: string;
        csv: string;
        total: number;
      };
      downloadTextFile(
        exportResult.filename,
        exportResult.csv,
        "text/csv;charset=utf-8",
      );
      toast.success(`Exported ${exportResult.total} bookings`);
    },
    onError: (error) => {
      toast.error("Could not export bookings", {
        description: error.message,
      });
    },
  });

  const pluginInfo = rawPluginInfo as TableBookingPluginInfo | undefined;
  const draft = useTableBookingConfigDraft(pluginInfo?.config);
  const reservationEditor = useTableBookingReservationEditor({
    selectedDate,
    timezone: draft.timezone,
    setSelectedDate,
    setVisibleMonth,
    setActiveTab,
  });
  const capacityEditor = useTableBookingCapacityAdjustmentEditor({
    selectedDate,
    weeklySchedule: draft.weeklySchedule,
    dateOverrides: draft.dateOverrides,
  });
  const summary = summaryQuery.data?.result as
    | TableBookingSummaryPayload
    | undefined;
  const monthBookings = monthBookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;
  const dayCapacity = dayCapacityQuery.data?.result as
    | TableBookingDayCapacityPayload
    | undefined;
  const selectedDayBookings = selectedDateBookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;
  const bookings = bookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;

  useEffect(() => {
    setBookingOffset(0);
  }, [bookingStatus, bookingSourceChannel, bookingSearch, startDate, endDate]);
  const isRefreshing =
    pluginInfoQuery.isFetching ||
    summaryQuery.isFetching ||
    monthBookingsQuery.isFetching ||
    dayCapacityQuery.isFetching ||
    selectedDateBookingsQuery.isFetching ||
    bookingsQuery.isFetching;

  const draftConfigResult = tableBookingPluginConfigSchema.safeParse(
    draft.buildDraftConfig(),
  );
  const hasUnsavedChanges = pluginInfo?.config
    ? !draftConfigResult.success ||
      serializeComparableConfig(draftConfigResult.data) !==
        serializeComparableConfig(pluginInfo.config)
    : false;

  const handleSaveConfig = () => {
    const result = tableBookingPluginConfigSchema.safeParse(
      draft.buildDraftConfig(),
    );
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
      pluginId: typedPluginId,
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

  const saveCapacityAdjustment = () => {
    saveCapacityAdjustmentMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId: TABLE_BOOKING_SAVE_CAPACITY_ADJUSTMENT_ACTION_ID,
      input: {
        adjustmentId: capacityEditor.editingAdjustmentId ?? undefined,
        serviceDate: selectedDate,
        startTime: capacityEditor.adjustmentStartTime,
        endTime: capacityEditor.adjustmentEndTime,
        mode: capacityEditor.adjustmentMode,
        capacityValue:
          capacityEditor.adjustmentMode === "closed"
            ? null
            : Number.parseInt(
                capacityEditor.adjustmentCapacityValue || "0",
                10,
              ),
        reason: capacityEditor.adjustmentReason.trim() || null,
      },
    });
  };

  const exportBookings = () => {
    exportBookingsMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId: TABLE_BOOKING_EXPORT_BOOKINGS_ACTION_ID,
      input: {
        status: bookingStatus,
        sourceChannel: bookingSourceChannel,
        search: bookingSearch,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      },
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
  const bookingRangeStart =
    bookings && bookings.total > 0 ? bookingOffset + 1 : 0;
  const bookingRangeEnd = bookings
    ? Math.min(bookingOffset + bookingsRows.length, bookings.total)
    : 0;
  const canLoadPreviousBookings = bookingOffset > 0;
  const canLoadMoreBookings = bookingRangeEnd < (bookings?.total ?? 0);
  const readErrors = [
    summaryQuery.error ? `Summary: ${summaryQuery.error.message}` : null,
    monthBookingsQuery.error
      ? `Calendar: ${monthBookingsQuery.error.message}`
      : null,
    dayCapacityQuery.error
      ? `Capacity: ${dayCapacityQuery.error.message}`
      : null,
    selectedDateBookingsQuery.error
      ? `Selected day: ${selectedDateBookingsQuery.error.message}`
      : null,
    bookingsQuery.error
      ? `Booking search: ${bookingsQuery.error.message}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <SettingsPageShell
      title="Table Booking"
      description="Operate bookings from a calendar-first view, then adjust hours and widget settings without dropping into raw config."
      className={
        isEmbedded ? "mx-auto w-full max-w-7xl px-4 py-4 sm:px-6" : undefined
      }
      actions={
        <ProjectPluginPageActions
          projectSlug={projectSlug}
          isEmbedded={isEmbedded}
          onRefresh={() => {
            void refreshPluginPage([
              () => summaryQuery.refetch(),
              () => monthBookingsQuery.refetch(),
              () => dayCapacityQuery.refetch(),
              () => selectedDateBookingsQuery.refetch(),
              () => bookingsQuery.refetch(),
            ]);
          }}
          isRefreshing={isRefreshing}
        >
          {pluginEnabled ? (
            <>
              {hasUnsavedChanges ? (
                <Badge variant="secondary">Unsaved changes</Badge>
              ) : null}
              <Button variant="outline" asChild>
                <Link
                  to={ROUTES.PROJECT_PLUGIN_OPERATOR(
                    projectSlug,
                    "table_booking",
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Monitor className="h-4 w-4" />
                  Open service mode
                </Link>
              </Button>
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
        </ProjectPluginPageActions>
      }
    >
      <div className={isEmbedded ? "mx-auto max-w-7xl space-y-5" : "space-y-5"}>
        <Panel className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-md border bg-surface-sunken text-muted-foreground">
                  <PluginIcon className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-semibold">
                  Project: {projectTitle}
                </h2>
                <StatusPill tone={pluginEnabled ? "success" : "neutral"}>
                  {pluginEnabled
                    ? "Enabled"
                    : pluginInfo?.entitled
                      ? "Available"
                      : "Disabled"}
                </StatusPill>
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
            {!pluginEnabled ? (
              <ProjectPluginAccessActions
                canEnablePlugin={needsEnable && canEnablePlugin}
                canRequestPluginAccess={
                  !(needsEnable && canEnablePlugin) && canRequestPluginAccess
                }
                isEnablePending={ensureMutation.isPending}
                isRequestPending={isRequestPending}
                isRequestSubmitting={requestAccessMutation.isPending}
                requestAccessLabel={requestAccessLabel}
                onEnable={() =>
                  ensureMutation.mutate({
                    slug: projectSlug,
                    pluginId: typedPluginId,
                  })
                }
                onRequestAccess={() =>
                  requestAccessMutation.mutate({
                    slug: projectSlug,
                    pluginId: typedPluginId,
                  })
                }
                size="default"
              />
            ) : null}
          </div>
          {pluginInfoQuery.error ? (
            <Callout tone="danger" className="mt-4">
              <CalloutDescription>
                Failed to load plugin info: {pluginInfoQuery.error.message}
              </CalloutDescription>
            </Callout>
          ) : null}
        </Panel>

        {pluginEnabled ? (
          <>
            {readErrors.length > 0 ? (
              <Callout tone="danger">
                <CalloutDescription>
                  Some booking data could not load. {readErrors.join(" ")}
                </CalloutDescription>
              </Callout>
            ) : null}

            <Panel className="flex flex-wrap items-stretch gap-x-6 gap-y-3 px-4 py-3">
              <StatInline
                icon={CalendarDays}
                label="Today"
                value={String(summary?.counts.bookingsToday ?? 0)}
                note={`${summary?.counts.coversToday ?? 0} covers`}
              />
              <Separator
                orientation="vertical"
                className="hidden h-auto sm:block"
              />
              <StatInline
                icon={Users}
                label="Upcoming"
                value={String(summary?.counts.upcomingBookings ?? 0)}
                note={`${summary?.counts.upcomingCovers ?? 0} covers`}
              />
              <Separator
                orientation="vertical"
                className="hidden h-auto sm:block"
              />
              <StatInline
                icon={BellRing}
                label="Issues"
                value={String(
                  (summary?.counts.cancelled ?? 0) +
                    (summary?.counts.noShow ?? 0),
                )}
                note={`${summary?.counts.cancelled ?? 0} cancelled · ${summary?.counts.noShow ?? 0} no-show`}
                tone={
                  (summary?.counts.cancelled ?? 0) +
                    (summary?.counts.noShow ?? 0) >
                  0
                    ? "warning"
                    : "default"
                }
              />
            </Panel>

            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as SettingsTab)}
            >
              <TabsList className="grid h-auto w-full grid-cols-2 rounded-md bg-surface-sunken p-1 md:grid-cols-4">
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
                <TableBookingCalendarTab
                  timezone={draft.timezone}
                  visibleMonth={visibleMonth}
                  setVisibleMonth={setVisibleMonth}
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  setActiveTab={setActiveTab}
                  draft={draft}
                  monthBookings={monthBookings}
                  monthBookingsQuery={{
                    isLoading: monthBookingsQuery.isLoading,
                  }}
                  selectedDayBookings={selectedDayBookings}
                  selectedDateBookingsQuery={{
                    isLoading: selectedDateBookingsQuery.isLoading,
                    error: selectedDateBookingsQuery.error,
                  }}
                  dayCapacity={dayCapacity}
                  dayCapacityQuery={{
                    isLoading: dayCapacityQuery.isLoading,
                    error: dayCapacityQuery.error,
                  }}
                  reservationEditor={reservationEditor}
                  capacityEditor={capacityEditor}
                  actionPending={actionMutation.isPending}
                  reservationPending={saveReservationMutation.isPending}
                  saveReservation={saveReservation}
                  capacitySavePending={saveCapacityAdjustmentMutation.isPending}
                  saveCapacityAdjustment={saveCapacityAdjustment}
                  deleteCapacityAdjustment={(adjustmentId) =>
                    deleteCapacityAdjustmentMutation.mutate({
                      slug: projectSlug,
                      pluginId: typedPluginId,
                      actionId:
                        TABLE_BOOKING_DELETE_CAPACITY_ADJUSTMENT_ACTION_ID,
                      input: {
                        adjustmentId,
                      },
                    })
                  }
                  deleteCapacityAdjustmentPending={
                    deleteCapacityAdjustmentMutation.isPending
                  }
                  runBookingAction={runBookingAction}
                  reservationSheetOpen={reservationSheetOpen}
                  setReservationSheetOpen={setReservationSheetOpen}
                  capacitySheetOpen={capacitySheetOpen}
                  setCapacitySheetOpen={setCapacitySheetOpen}
                />
              </TabsContent>

              <TabsContent value="bookings" className="space-y-5">
                <TableBookingBookingsTab
                  timezone={draft.timezone}
                  bookingStatus={bookingStatus}
                  setBookingStatus={setBookingStatus}
                  bookingSourceChannel={bookingSourceChannel}
                  setBookingSourceChannel={setBookingSourceChannel}
                  bookingSearch={bookingSearch}
                  setBookingSearch={setBookingSearch}
                  startDate={startDate}
                  setStartDate={setStartDate}
                  endDate={endDate}
                  setEndDate={setEndDate}
                  bookings={bookings}
                  bookingsQuery={{
                    isLoading: bookingsQuery.isLoading,
                    error: bookingsQuery.error,
                  }}
                  bookingsRows={bookingsRows}
                  bookingRangeStart={bookingRangeStart}
                  bookingRangeEnd={bookingRangeEnd}
                  canLoadPreviousBookings={canLoadPreviousBookings}
                  canLoadMoreBookings={canLoadMoreBookings}
                  setBookingOffset={setBookingOffset}
                  limit={limit}
                  exportBookings={exportBookings}
                  exportPending={exportBookingsMutation.isPending}
                  actionPending={
                    actionMutation.isPending ||
                    saveReservationMutation.isPending
                  }
                  runBookingAction={runBookingAction}
                  onEditBooking={(booking) => {
                    reservationEditor.startEditingReservation(booking);
                    setReservationSheetOpen(true);
                  }}
                />
              </TabsContent>

              <TabsContent value="setup" className="space-y-5">
                <TableBookingSetupTab
                  draft={draft}
                  pluginInfo={pluginInfo}
                  setSelectedDate={setSelectedDate}
                  setVisibleMonth={setVisibleMonth}
                  setActiveTab={setActiveTab}
                />
              </TabsContent>

              <TabsContent value="install" className="space-y-5">
                <TableBookingInstallTab
                  pluginInfo={pluginInfo}
                  copyText={copyText}
                />
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
