import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BellRing,
  CalendarDays,
  Loader2,
  NotebookPen,
  RefreshCw,
  Settings2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppConfig } from "@/lib/AppConfigContext";
import { authClient } from "@/lib/auth-client";
import { formatDocumentTitle } from "@/lib/brand";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import {
  getPluginAccessRequestLabel,
  getProjectPluginPresentation,
  isPluginAccessRequestPending,
} from "@/plugins/presentation";
import { tableBookingPluginConfigSchema } from "../backend/config";
import {
  TABLE_BOOKING_BOOKINGS_READ_ID,
  TABLE_BOOKING_SUMMARY_READ_ID,
} from "../shared/summary";
import { PLUGIN_READ_REFETCH_INTERVAL_MS } from "./tableBookingProjectPage/constants";
import { TableBookingBookingsTab } from "./tableBookingProjectPage/BookingsTab";
import { TableBookingCalendarTab } from "./tableBookingProjectPage/CalendarTab";
import { TableBookingInstallTab } from "./tableBookingProjectPage/InstallTab";
import { MetricCard, SectionCard } from "./tableBookingProjectPage/shared";
import { TableBookingSetupTab } from "./tableBookingProjectPage/SetupTab";
import type {
  SettingsTab,
  TableBookingBookingsPayload,
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
} from "./tableBookingProjectPage/utils";
import { useTableBookingCapacityAdjustmentEditor } from "./tableBookingProjectPage/useCapacityAdjustmentEditor";
import { useTableBookingConfigDraft } from "./tableBookingProjectPage/useConfigDraft";
import { useTableBookingReservationEditor } from "./tableBookingProjectPage/useReservationEditor";

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
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [visibleMonth, setVisibleMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [bookingStatus, setBookingStatus] = useState<"all" | TableBookingStatus>(
    "all",
  );
  const [bookingSourceChannel, setBookingSourceChannel] = useState<
    "all" | TableBookingSourceChannel
  >("all");
  const [bookingSearch, setBookingSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [bookingOffset, setBookingOffset] = useState(0);
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
  const dayCapacityQuery = trpc.plugins.tableBooking.dayCapacity.useQuery(
    {
      slug: projectSlug,
      serviceDate: selectedDate,
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
      reservationEditor.resetReservationEditor(variables.date);
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
        capacityEditor.resetCapacityAdjustmentForm(variables.serviceDate);
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
        capacityEditor.resetCapacityAdjustmentForm(selectedDate);
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

  const pluginInfo = pluginInfoQuery.data as TableBookingPluginInfo | undefined;
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
  const summary = summaryQuery.data?.result as TableBookingSummaryPayload | undefined;
  const monthBookings = monthBookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;
  const selectedDayBookings = selectedDateBookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;
  const bookings = bookingsQuery.data?.result as
    | TableBookingBookingsPayload
    | undefined;

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
    saveReservationMutation.mutate({
      slug: projectSlug,
      bookingId: reservationEditor.editingBookingId ?? undefined,
      date: reservationEditor.reservationDate,
      time: reservationEditor.reservationTime,
      partySize: Number.parseInt(reservationEditor.reservationPartySize || "0", 10),
      name: reservationEditor.reservationName.trim(),
      email: reservationEditor.reservationEmail.trim(),
      phone: reservationEditor.reservationPhone.trim(),
      notes: reservationEditor.reservationNotes.trim() || null,
      sourceChannel: reservationEditor.reservationSourceChannel,
      sendGuestNotification: reservationEditor.sendGuestNotification,
    });
  };

  const saveCapacityAdjustment = () => {
    saveCapacityAdjustmentMutation.mutate({
      slug: projectSlug,
      adjustmentId: capacityEditor.editingAdjustmentId ?? undefined,
      serviceDate: selectedDate,
      startTime: capacityEditor.adjustmentStartTime,
      endTime: capacityEditor.adjustmentEndTime,
      mode: capacityEditor.adjustmentMode,
      capacityValue:
        capacityEditor.adjustmentMode === "closed"
          ? null
          : Number.parseInt(capacityEditor.adjustmentCapacityValue || "0", 10),
      reason: capacityEditor.adjustmentReason.trim() || null,
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

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)}>
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
                  dayCapacity={dayCapacityQuery.data}
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
                      adjustmentId,
                    })
                  }
                  deleteCapacityAdjustmentPending={
                    deleteCapacityAdjustmentMutation.isPending
                  }
                  runBookingAction={runBookingAction}
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
                    actionMutation.isPending || saveReservationMutation.isPending
                  }
                  reservationEditor={reservationEditor}
                  runBookingAction={runBookingAction}
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
                <TableBookingInstallTab pluginInfo={pluginInfo} copyText={copyText} />
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
