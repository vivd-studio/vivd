import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { authClient } from "@/lib/auth-client";
import { formatDocumentTitle } from "@/lib/brand";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import {
  TABLE_BOOKING_AGENDA_READ_ID,
  TABLE_BOOKING_BOOKINGS_READ_ID,
  TABLE_BOOKING_SUMMARY_READ_ID,
  type TableBookingAgendaPayload,
  type TableBookingBookingsPayload,
  type TableBookingSummaryPayload,
} from "../shared/summary";

type TableBookingProjectPageProps = {
  projectSlug: string;
  isEmbedded?: boolean;
};

type TableBookingConfig = {
  timezone: string;
  sourceHosts: string[];
  redirectHostAllowlist: string[];
  notificationRecipientEmails: string[];
  partySize: {
    min: number;
    max: number;
  };
  leadTimeMinutes: number;
  bookingHorizonDays: number;
  defaultDurationMinutes: number;
  cancellationCutoffMinutes: number;
  collectNotes: boolean;
  weeklySchedule: unknown[];
  dateOverrides: unknown[];
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

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function StatCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {caption ? <p className="mt-1 text-xs text-muted-foreground">{caption}</p> : null}
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
        <h4 className="text-sm font-medium">{title}</h4>
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy
        </Button>
      </div>
      <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
        {snippet}
      </pre>
    </div>
  );
}

export default function TableBookingProjectPage({
  projectSlug,
  isEmbedded = false,
}: TableBookingProjectPageProps) {
  const utils = trpc.useUtils();
  const { data: session } = authClient.useSession();
  const canEnablePlugin = session?.user?.role === "super_admin";
  const typedPluginId =
    "table_booking" as RouterOutputs["plugins"]["catalog"]["plugins"][number]["pluginId"];

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
  const [weeklyScheduleInput, setWeeklyScheduleInput] = useState("[]");
  const [dateOverridesInput, setDateOverridesInput] = useState("[]");
  const [bookingStatus, setBookingStatus] = useState<
    "all" | "confirmed" | "cancelled_by_guest" | "cancelled_by_staff" | "no_show" | "completed"
  >("all");
  const [bookingSearch, setBookingSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const limit = 100;

  const projectListQuery = trpc.project.list.useQuery(undefined, {
    enabled: !!projectSlug,
  });
  const pluginInfoQuery = trpc.plugins.info.useQuery(
    { slug: projectSlug, pluginId: typedPluginId },
    { enabled: !!projectSlug },
  );
  const summaryQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: TABLE_BOOKING_SUMMARY_READ_ID,
      input: { rangeDays: 7 },
    },
    { enabled: !!projectSlug },
  );
  const bookingsQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: TABLE_BOOKING_BOOKINGS_READ_ID,
      input: {
        status: bookingStatus,
        search: bookingSearch,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit,
        offset: 0,
      },
    },
    { enabled: !!projectSlug },
  );
  const agendaQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: TABLE_BOOKING_AGENDA_READ_ID,
      input: { rangeDays: 7 },
    },
    { enabled: !!projectSlug },
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

  const pluginInfo = pluginInfoQuery.data as
    | (RouterOutputs["plugins"]["info"] & {
        config: TableBookingConfig | null;
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
  const bookings = bookingsQuery.data?.result as TableBookingBookingsPayload | undefined;
  const agenda = agendaQuery.data?.result as TableBookingAgendaPayload | undefined;

  useEffect(() => {
    if (!pluginInfo?.config) return;
    setTimezone(pluginInfo.config.timezone);
    setSourceHostsInput(formatListInput(pluginInfo.config.sourceHosts ?? []));
    setRedirectHostsInput(formatListInput(pluginInfo.config.redirectHostAllowlist ?? []));
    setNotificationRecipientsInput(
      formatListInput(pluginInfo.config.notificationRecipientEmails ?? []),
    );
    setPartyMin(String(pluginInfo.config.partySize?.min ?? 1));
    setPartyMax(String(pluginInfo.config.partySize?.max ?? 8));
    setLeadTimeMinutes(String(pluginInfo.config.leadTimeMinutes ?? 120));
    setBookingHorizonDays(String(pluginInfo.config.bookingHorizonDays ?? 60));
    setDefaultDurationMinutes(String(pluginInfo.config.defaultDurationMinutes ?? 90));
    setCancellationCutoffMinutes(
      String(pluginInfo.config.cancellationCutoffMinutes ?? 120),
    );
    setCollectNotes(Boolean(pluginInfo.config.collectNotes));
    setWeeklyScheduleInput(prettyJson(pluginInfo.config.weeklySchedule ?? []));
    setDateOverridesInput(prettyJson(pluginInfo.config.dateOverrides ?? []));
  }, [pluginInfo?.config]);

  const projectTitle =
    projectListQuery.data?.projects?.find((project) => project.slug === projectSlug)?.title ??
    projectSlug;

  useEffect(() => {
    if (!projectSlug) return;
    document.title = formatDocumentTitle(`${projectTitle} Table Booking`);
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [projectSlug, projectTitle]);

  const pluginEnabled = !!pluginInfo?.enabled;
  const needsEnable = (pluginInfo?.entitled ?? false) && !pluginEnabled && !pluginInfo?.instanceId;
  const isLoading =
    pluginInfoQuery.isLoading || summaryQuery.isLoading || bookingsQuery.isLoading;

  const handleSaveConfig = () => {
    let weeklySchedule: unknown;
    let dateOverrides: unknown;
    try {
      weeklySchedule = JSON.parse(weeklyScheduleInput);
      dateOverrides = JSON.parse(dateOverridesInput);
    } catch (error) {
      toast.error("Schedule fields must be valid JSON", {
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    saveConfigMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      config: {
        timezone,
        sourceHosts: parseListInput(sourceHostsInput),
        redirectHostAllowlist: parseListInput(redirectHostsInput),
        notificationRecipientEmails: parseListInput(notificationRecipientsInput),
        partySize: {
          min: Number.parseInt(partyMin || "1", 10),
          max: Number.parseInt(partyMax || "8", 10),
        },
        leadTimeMinutes: Number.parseInt(leadTimeMinutes || "120", 10),
        bookingHorizonDays: Number.parseInt(bookingHorizonDays || "60", 10),
        defaultDurationMinutes: Number.parseInt(defaultDurationMinutes || "90", 10),
        cancellationCutoffMinutes: Number.parseInt(
          cancellationCutoffMinutes || "120",
          10,
        ),
        collectNotes,
        weeklySchedule,
        dateOverrides,
      },
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

  const bookingsRows = bookings?.rows ?? [];
  const agendaGroups = agenda?.groups ?? [];

  return (
    <SettingsPageShell
      title="Table Booking"
      description="Accept reservations from the live site and manage upcoming bookings."
      className={isEmbedded ? "mx-auto w-full max-w-6xl px-4 py-4 sm:px-6" : undefined}
      actions={
        <div className="flex items-center gap-2">
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
                bookingsQuery.refetch(),
                agendaQuery.refetch(),
              ]);
            }}
            disabled={isLoading}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>
      }
    >
      <div className={isEmbedded ? "mx-auto max-w-6xl space-y-4" : "space-y-4"}>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Booking status</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Project: {projectTitle}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!pluginEnabled && needsEnable && canEnablePlugin ? (
                  <Button
                    size="sm"
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
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        Enabling...
                      </>
                    ) : (
                      "Enable for this project"
                    )}
                  </Button>
                ) : null}
                <Badge variant={pluginEnabled ? "default" : "outline"}>
                  {pluginEnabled ? "Enabled" : pluginInfo?.entitled ? "Available" : "Disabled"}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {pluginInfoQuery.error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Failed to load plugin info: {pluginInfoQuery.error.message}
              </div>
            ) : null}
            {!pluginEnabled ? (
              <p className="text-sm text-muted-foreground">
                {pluginInfo?.entitled
                  ? canEnablePlugin
                    ? "Table Booking is available but not enabled for this project yet."
                    : "Table Booking is available, but a super-admin still needs to enable it."
                  : "Table Booking access is managed in the admin plugin settings."}
              </p>
            ) : null}
            {pluginInfo?.usage ? (
              <div className="text-sm text-muted-foreground space-y-1">
                <div>Availability endpoint: {pluginInfo.usage.availabilityEndpoint}</div>
                <div>Booking endpoint: {pluginInfo.usage.bookEndpoint}</div>
                <div>Cancel endpoint: {pluginInfo.usage.cancelEndpoint}</div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <section className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Bookings Today"
            value={String(summary?.counts.bookingsToday ?? 0)}
            caption={`${summary?.counts.coversToday ?? 0} covers`}
          />
          <StatCard
            label="Upcoming"
            value={String(summary?.counts.upcomingBookings ?? 0)}
            caption={`${summary?.counts.upcomingCovers ?? 0} upcoming covers`}
          />
          <StatCard
            label="Recent Issues"
            value={String((summary?.counts.cancelled ?? 0) + (summary?.counts.noShow ?? 0))}
            caption={`${summary?.counts.cancelled ?? 0} cancelled, ${summary?.counts.noShow ?? 0} no-show`}
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming Agenda</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {agendaGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming bookings in the next 7 days.</p>
            ) : (
              agendaGroups.map((group) => (
                <div key={group.serviceDate} className="space-y-2">
                  <h3 className="text-sm font-medium">{group.serviceDate}</h3>
                  <div className="grid gap-2">
                    {group.bookings.map((booking) => (
                      <div
                        key={booking.id}
                        className="rounded-lg border bg-muted/15 p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">
                            {booking.guestName} · party of {booking.partySize}
                          </div>
                          <Badge variant="outline">{booking.status}</Badge>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {formatDateTime(booking.serviceStartAt)} · {booking.guestPhone}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bookings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={bookingStatus} onValueChange={(value) => setBookingStatus(value as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="cancelled_by_guest">Cancelled by guest</SelectItem>
                    <SelectItem value="cancelled_by_staff">Cancelled by staff</SelectItem>
                    <SelectItem value="no_show">No-show</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Search</Label>
                <Input
                  value={bookingSearch}
                  onChange={(event) => setBookingSearch(event.target.value)}
                  placeholder="Name, email, phone"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            </div>

            <div className="grid gap-3">
              {bookingsRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bookings match the current filters.</p>
              ) : (
                bookingsRows.map((booking) => (
                  <div key={booking.id} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">
                          {booking.guestName} · party of {booking.partySize}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatDateTime(booking.serviceStartAt)} · {booking.guestEmail} · {booking.guestPhone}
                        </div>
                        {booking.notes ? (
                          <div className="mt-1 text-sm text-muted-foreground">
                            Notes: {booking.notes}
                          </div>
                        ) : null}
                      </div>
                      <Badge variant="outline">{booking.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionMutation.isPending || booking.status.startsWith("cancelled")}
                        onClick={() =>
                          actionMutation.mutate({
                            slug: projectSlug,
                            pluginId: typedPluginId,
                            actionId: "cancel_booking",
                            args: [booking.id],
                          })
                        }
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionMutation.isPending || booking.status === "no_show"}
                        onClick={() =>
                          actionMutation.mutate({
                            slug: projectSlug,
                            pluginId: typedPluginId,
                            actionId: "mark_no_show",
                            args: [booking.id],
                          })
                        }
                      >
                        Mark no-show
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionMutation.isPending || booking.status === "completed"}
                        onClick={() =>
                          actionMutation.mutate({
                            slug: projectSlug,
                            pluginId: typedPluginId,
                            actionId: "mark_completed",
                            args: [booking.id],
                          })
                        }
                      >
                        Mark completed
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Config</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Min party size</Label>
                  <Input value={partyMin} onChange={(event) => setPartyMin(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Max party size</Label>
                  <Input value={partyMax} onChange={(event) => setPartyMax(event.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Lead time (minutes)</Label>
                  <Input value={leadTimeMinutes} onChange={(event) => setLeadTimeMinutes(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Booking horizon (days)</Label>
                  <Input
                    value={bookingHorizonDays}
                    onChange={(event) => setBookingHorizonDays(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Default duration (minutes)</Label>
                  <Input
                    value={defaultDurationMinutes}
                    onChange={(event) => setDefaultDurationMinutes(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Cancellation cutoff (minutes)</Label>
                  <Input
                    value={cancellationCutoffMinutes}
                    onChange={(event) => setCancellationCutoffMinutes(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Source hosts</Label>
                <Textarea
                  value={sourceHostsInput}
                  onChange={(event) => setSourceHostsInput(event.target.value)}
                  rows={4}
                  placeholder="example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Redirect allowlist</Label>
                <Textarea
                  value={redirectHostsInput}
                  onChange={(event) => setRedirectHostsInput(event.target.value)}
                  rows={4}
                  placeholder="example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Notification recipient emails</Label>
                <Textarea
                  value={notificationRecipientsInput}
                  onChange={(event) => setNotificationRecipientsInput(event.target.value)}
                  rows={4}
                  placeholder="reservations@example.com"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={collectNotes} onCheckedChange={(value) => setCollectNotes(Boolean(value))} />
                Collect guest notes
              </label>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Weekly schedule JSON</Label>
                <Textarea
                  value={weeklyScheduleInput}
                  onChange={(event) => setWeeklyScheduleInput(event.target.value)}
                  rows={12}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date overrides JSON</Label>
                <Textarea
                  value={dateOverridesInput}
                  onChange={(event) => setDateOverridesInput(event.target.value)}
                  rows={8}
                />
              </div>
            </div>
            <div className="lg:col-span-2 flex justify-end">
              <Button onClick={handleSaveConfig} disabled={saveConfigMutation.isPending}>
                {saveConfigMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save settings"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Snippets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {pluginInfo?.snippets ? (
              <>
                <SnippetCard
                  title="HTML"
                  snippet={pluginInfo.snippets.html}
                  onCopy={() => void copyText(pluginInfo.snippets?.html || "", "HTML snippet")}
                />
                <SnippetCard
                  title="Astro"
                  snippet={pluginInfo.snippets.astro}
                  onCopy={() => void copyText(pluginInfo.snippets?.astro || "", "Astro snippet")}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Enable the plugin for this project to generate install snippets.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </SettingsPageShell>
  );
}
