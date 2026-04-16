import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
import { useAppConfig } from "@/lib/AppConfigContext";
import { formatDocumentTitle } from "@/lib/brand";
import { authClient } from "@/lib/auth-client";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import {
  getPluginAccessRequestLabel,
  getProjectPluginPresentation,
  isPluginAccessRequestPending,
} from "@/plugins/presentation";
import {
  NEWSLETTER_CAMPAIGNS_READ_ID,
  NEWSLETTER_SUBSCRIBERS_READ_ID,
  NEWSLETTER_SUMMARY_READ_ID,
  type NewsletterCampaignsPayload,
  type NewsletterSubscribersPayload,
  type NewsletterSummaryPayload,
} from "../shared/summary";

type NewsletterProjectPageProps = {
  projectSlug: string;
  isEmbedded?: boolean;
};

type NewsletterPluginConfig = {
  mode: "newsletter" | "waitlist";
  collectName: boolean;
  sourceHosts: string[];
  redirectHostAllowlist: string[];
};

type NewsletterCampaignAudience = "all_confirmed" | "mode_confirmed";

function getCampaignAudienceLabel(
  audience: NewsletterCampaignAudience,
  currentMode: "newsletter" | "waitlist",
): string {
  return audience === "mode_confirmed"
    ? `Confirmed (${currentMode})`
    : "All confirmed";
}

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

function formatDate(value: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const keys = Array.from(
    rows.reduce((set, row) => {
      for (const key of Object.keys(row)) set.add(key);
      return set;
    }, new Set<string>()),
  );
  const escape = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const content = [
    keys.join(","),
    ...rows.map((row) => keys.map((key) => escape(row[key])).join(",")),
  ].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

export default function NewsletterProjectPage({
  projectSlug,
  isEmbedded = false,
}: NewsletterProjectPageProps) {
  const { config } = useAppConfig();
  const utils = trpc.useUtils();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const canEnablePlugin = session?.user?.role === "super_admin";
  const canRequestPluginAccess =
    !isSessionPending && !canEnablePlugin && Boolean(config.supportEmail);
  const typedPluginId =
    "newsletter" as RouterOutputs["plugins"]["catalog"]["plugins"][number]["pluginId"];

  const [mode, setMode] = useState<"newsletter" | "waitlist">("newsletter");
  const [collectName, setCollectName] = useState(false);
  const [sourceHostsInput, setSourceHostsInput] = useState("");
  const [redirectHostsInput, setRedirectHostsInput] = useState("");
  const [campaignSubject, setCampaignSubject] = useState("");
  const [campaignBody, setCampaignBody] = useState("");
  const [campaignAudience, setCampaignAudience] =
    useState<NewsletterCampaignAudience>("all_confirmed");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignSelectionMode, setCampaignSelectionMode] = useState<"auto" | "manual">(
    "auto",
  );
  const [editingNewCampaign, setEditingNewCampaign] = useState(false);
  const [campaignOffset, setCampaignOffset] = useState(0);
  const [deleteCampaignId, setDeleteCampaignId] = useState<string | null>(null);
  const [subscriberStatus, setSubscriberStatus] = useState<
    "all" | "pending" | "confirmed" | "unsubscribed" | "bounced" | "complained"
  >("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [unsubscribeEmail, setUnsubscribeEmail] = useState<string | null>(null);
  const limit = 100;
  const campaignLimit = 20;

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
      readId: NEWSLETTER_SUMMARY_READ_ID,
      input: { rangeDays: 30 },
    },
    { enabled: !!projectSlug },
  );
  const campaignsQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: NEWSLETTER_CAMPAIGNS_READ_ID,
      input: {
        status: "all",
        limit: campaignLimit,
        offset: campaignOffset,
      },
    },
    { enabled: !!projectSlug },
  );
  const subscribersQuery = trpc.plugins.read.useQuery(
    {
      slug: projectSlug,
      pluginId: typedPluginId,
      readId: NEWSLETTER_SUBSCRIBERS_READ_ID,
      input: {
        status: subscriberStatus,
        search,
        limit,
        offset,
      },
    },
    { enabled: !!projectSlug },
  );

  const ensureMutation = trpc.plugins.ensure.useMutation({
    onSuccess: async () => {
      toast.success("Newsletter plugin enabled");
      await Promise.all([
        utils.plugins.catalog.invalidate({ slug: projectSlug }),
        utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId }),
        utils.plugins.read.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error("Failed to enable Newsletter", {
        description: error.message,
      });
    },
  });

  const saveConfigMutation = trpc.plugins.updateConfig.useMutation({
    onSuccess: async () => {
      toast.success("Newsletter settings saved");
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
      toast.success("Newsletter subscriber updated");
      await Promise.all([
        utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId }),
        utils.plugins.read.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error("Subscriber action failed", {
        description: error.message,
      });
    },
  });

  const campaignActionMutation = trpc.plugins.action.useMutation({
    onSuccess: async (result) => {
      if (result.actionId === "save_campaign_draft") {
        const payload = result.result as { campaignId?: string; estimatedRecipientCount?: number };
        if (payload.campaignId) {
          if (editingNewCampaign) {
            setCampaignOffset(0);
            setCampaignSelectionMode("manual");
          }
          setSelectedCampaignId(payload.campaignId);
          setEditingNewCampaign(false);
        }
        toast.success("Campaign draft saved", {
          description:
            typeof payload.estimatedRecipientCount === "number"
              ? `${payload.estimatedRecipientCount} confirmed recipients currently match this audience.`
              : undefined,
        });
      } else if (result.actionId === "delete_campaign_draft") {
        setDeleteCampaignId(null);
        if ((result.result as { campaignId?: string }).campaignId === selectedCampaignId) {
          setCampaignSelectionMode("auto");
          setSelectedCampaignId(null);
          setCampaignSubject("");
          setCampaignBody("");
          setCampaignAudience("all_confirmed");
        }
        toast.success("Campaign draft deleted");
      }

      await Promise.all([
        utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId }),
        utils.plugins.read.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error("Campaign action failed", {
        description: error.message,
      });
    },
  });

  const pluginInfo = pluginInfoQuery.data as
    | (RouterOutputs["plugins"]["info"] & {
        config: NewsletterPluginConfig | null;
        usage: {
          subscribeEndpoint: string;
          confirmEndpoint: string;
          unsubscribeEndpoint: string;
          expectedFields: string[];
          optionalFields: string[];
          inferredAutoSourceHosts: string[];
        } | null;
        snippets: {
          html: string;
          astro: string;
        } | null;
        details: {
          counts?: NewsletterSummaryPayload["counts"];
        } | null;
      })
    | undefined;
  const summary = summaryQuery.data?.result as NewsletterSummaryPayload | undefined;
  const campaigns = campaignsQuery.data?.result as
    | NewsletterCampaignsPayload
    | undefined;
  const subscribers = subscribersQuery.data?.result as
    | NewsletterSubscribersPayload
    | undefined;

  useEffect(() => {
    if (!pluginInfo?.config) return;
    setMode(pluginInfo.config.mode);
    setCollectName(Boolean(pluginInfo.config.collectName));
    setSourceHostsInput(formatListInput(pluginInfo.config.sourceHosts ?? []));
    setRedirectHostsInput(
      formatListInput(pluginInfo.config.redirectHostAllowlist ?? []),
    );
  }, [pluginInfo?.config]);

  useEffect(() => {
    if (!campaigns?.rows) return;
    if (editingNewCampaign) {
      return;
    }

    if (campaigns.rows.length === 0) {
      if (!selectedCampaignId) {
        setCampaignSubject("");
        setCampaignBody("");
        setCampaignAudience("all_confirmed");
      }
      return;
    }

    if (selectedCampaignId) {
      const selected = campaigns.rows.find((row) => row.id === selectedCampaignId);
      if (!selected) {
        if (campaignSelectionMode === "manual") {
          return;
        }
      } else {
        setCampaignSubject(selected.subject);
        setCampaignBody(selected.body);
        setCampaignAudience(selected.audience);
        if (campaignSelectionMode !== "auto") {
          setCampaignSelectionMode("auto");
        }
        return;
      }
    }

    const firstCampaign = campaigns.rows[0];
    setSelectedCampaignId(firstCampaign.id);
    setCampaignSubject(firstCampaign.subject);
    setCampaignBody(firstCampaign.body);
    setCampaignAudience(firstCampaign.audience);
  }, [campaignSelectionMode, campaigns?.rows, editingNewCampaign, selectedCampaignId]);

  useEffect(() => {
    if (
      campaignOffset > 0 &&
      campaigns &&
      campaigns.rows.length === 0 &&
      campaignOffset >= campaigns.total
    ) {
      setCampaignOffset(Math.max(0, campaignOffset - campaignLimit));
    }
  }, [campaignLimit, campaignOffset, campaigns]);

  const isLoading =
    pluginInfoQuery.isLoading ||
    summaryQuery.isLoading ||
    campaignsQuery.isLoading ||
    subscribersQuery.isLoading;
  const pluginEnabled = !!pluginInfo?.enabled;
  const pluginEntitled = pluginInfo?.entitled ?? false;
  const needsEnable = pluginEntitled && !pluginEnabled && !pluginInfo?.instanceId;
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

  const projectTitle =
    projectListQuery.data?.projects?.find((project) => project.slug === projectSlug)?.title ??
    projectSlug;

  useEffect(() => {
    if (isEmbedded) return;
    document.title = formatDocumentTitle(
      pluginEnabled ? `${projectTitle} · Newsletter` : `${projectTitle} · Plugins`,
    );
  }, [isEmbedded, pluginEnabled, projectTitle]);

  const pageCount = useMemo(() => {
    const total = subscribers?.total ?? 0;
    return Math.max(1, Math.ceil(total / limit));
  }, [subscribers?.total]);

  const currentPage = useMemo(() => Math.floor(offset / limit) + 1, [offset]);
  const campaignPageCount = useMemo(() => {
    const total = campaigns?.total ?? 0;
    return Math.max(1, Math.ceil(total / campaignLimit));
  }, [campaignLimit, campaigns?.total]);
  const currentCampaignPage = useMemo(
    () => Math.floor(campaignOffset / campaignLimit) + 1,
    [campaignLimit, campaignOffset],
  );
  const selectedCampaign = useMemo(
    () => campaigns?.rows.find((row) => row.id === selectedCampaignId) ?? null,
    [campaigns?.rows, selectedCampaignId],
  );
  const currentCampaignRecipientEstimate =
    campaignAudience === "mode_confirmed"
      ? (campaigns?.audienceOptions.modeConfirmed ?? 0)
      : (campaigns?.audienceOptions.allConfirmed ?? 0);

  const saveConfig = () => {
    saveConfigMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      config: {
        mode,
        collectName,
        sourceHosts: parseListInput(sourceHostsInput),
        redirectHostAllowlist: parseListInput(redirectHostsInput),
      },
    });
  };

  const startNewCampaignDraft = () => {
    setCampaignSelectionMode("auto");
    setEditingNewCampaign(true);
    setSelectedCampaignId(null);
    setCampaignSubject("");
    setCampaignBody("");
    setCampaignAudience("all_confirmed");
  };

  const openCampaignFromList = (campaignId: string) => {
    const selected = campaigns?.rows.find((row) => row.id === campaignId);
    setCampaignSelectionMode("auto");
    setEditingNewCampaign(false);
    setSelectedCampaignId(campaignId);
    if (selected) {
      setCampaignSubject(selected.subject);
      setCampaignBody(selected.body);
      setCampaignAudience(selected.audience);
    }
  };

  const goToCampaignPage = (nextOffset: number) => {
    setCampaignSelectionMode("auto");
    setEditingNewCampaign(false);
    setSelectedCampaignId(null);
    setCampaignOffset(nextOffset);
  };

  const saveCampaignDraft = () => {
    campaignActionMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId: "save_campaign_draft",
      args: [
        editingNewCampaign || !selectedCampaignId ? "new" : selectedCampaignId,
        campaignSubject,
        campaignBody,
        campaignAudience,
      ],
    });
  };

  const exportCurrentRows = () => {
    if (!subscribers || subscribers.rows.length === 0) {
      toast.error("No subscriber rows available to export");
      return;
    }
    downloadCsv(
      `${projectSlug}-newsletter-${subscriberStatus}.csv`,
      subscribers.rows.map((row) => ({
        email: row.email,
        name: row.name,
        status: row.status,
        sourceHost: row.sourceHost,
        sourcePath: row.sourcePath,
        utmSource: row.utmSource,
        utmMedium: row.utmMedium,
        utmCampaign: row.utmCampaign,
        lastSignupAt: row.lastSignupAt,
        confirmedAt: row.confirmedAt,
        unsubscribedAt: row.unsubscribedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    );
  };

  const confirmUnsubscribe = () => {
    if (!unsubscribeEmail) return;
    actionMutation.mutate(
      {
        slug: projectSlug,
        pluginId: typedPluginId,
        actionId: "unsubscribe",
        args: [unsubscribeEmail],
      },
      {
        onSettled: () => setUnsubscribeEmail(null),
      },
    );
  };

  const confirmDeleteCampaign = () => {
    if (!deleteCampaignId) return;
    campaignActionMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId: "delete_campaign_draft",
      args: [deleteCampaignId],
    });
  };

  return (
    <SettingsPageShell
      title="Newsletter / Waitlist"
      description="Capture confirmed subscribers or waitlist signups for this project."
    >
      <div className="space-y-6">
        {needsEnable ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
                  <PluginIcon className="h-4 w-4" />
                </span>
                <span>Enable plugin</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Newsletter is entitled for this project but not enabled yet.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {canEnablePlugin ? (
                  <Button
                    onClick={() =>
                      ensureMutation.mutate({ slug: projectSlug, pluginId: typedPluginId })
                    }
                    disabled={ensureMutation.isPending}
                  >
                    {ensureMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enabling
                      </>
                    ) : (
                      "Enable Newsletter"
                    )}
                  </Button>
                ) : null}
                {canRequestPluginAccess ? (
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
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      getPluginAccessRequestLabel(pluginInfo?.accessRequest)
                    )}
                  </Button>
                ) : null}
              </div>
              {!canEnablePlugin && !isSessionPending ? (
                <p className="text-xs text-muted-foreground">
                  Only super-admin users can enable plugins directly.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Confirmed"
            value={String(summary?.counts.confirmed ?? 0)}
            caption={`+${summary?.recent.confirmations ?? 0} in last 30d`}
          />
          <StatCard
            label="Pending"
            value={String(summary?.counts.pending ?? 0)}
            caption={`+${summary?.recent.signups ?? 0} signups in last 30d`}
          />
          <StatCard
            label="Unsubscribed"
            value={String(summary?.counts.unsubscribed ?? 0)}
            caption={`+${summary?.recent.unsubscribes ?? 0} in last 30d`}
          />
        </section>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Campaigns</CardTitle>
              <p className="text-sm text-muted-foreground">
                Prepare broadcast drafts for confirmed subscribers.
              </p>
            </div>
            <Button variant="outline" onClick={startNewCampaignDraft}>
              New draft
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              This slice adds draft preparation and audience sizing only. Batched send
              execution is still the next broadcasting step.
            </p>
            <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Saved drafts</p>
                  <Badge variant="secondary">{campaigns?.total ?? 0}</Badge>
                </div>
                {campaigns?.rows.length ? (
                  <div className="space-y-2">
                    {campaigns.rows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          row.id === selectedCampaignId && !editingNewCampaign
                            ? "border-primary bg-muted/40"
                            : "hover:bg-muted/30"
                        }`}
                        onClick={() => openCampaignFromList(row.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate font-medium">{row.subject}</p>
                          <Badge variant="outline">{row.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {getCampaignAudienceLabel(row.audience, row.mode)}
                          {` • ${row.estimatedRecipientCount} recipients`}
                        </p>
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {row.body}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No campaign drafts yet.
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    {campaigns?.total ?? 0} drafts total, page {currentCampaignPage} of{" "}
                    {campaignPageCount}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        goToCampaignPage(Math.max(0, campaignOffset - campaignLimit))
                      }
                      disabled={campaignOffset === 0}
                    >
                      Previous drafts
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToCampaignPage(campaignOffset + campaignLimit)}
                      disabled={!campaigns || campaignOffset + campaignLimit >= campaigns.total}
                    >
                      Next drafts
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-lg border p-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-2">
                    <Label>Subject</Label>
                    <Input
                      value={campaignSubject}
                      placeholder="April launch update"
                      onChange={(event) => setCampaignSubject(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Audience</Label>
                    <Select
                      value={campaignAudience}
                      onValueChange={(value) =>
                        setCampaignAudience(value as NewsletterCampaignAudience)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all_confirmed">All confirmed</SelectItem>
                        <SelectItem value="mode_confirmed">
                          Confirmed ({campaigns?.currentMode ?? mode})
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Body</Label>
                  <Textarea
                    value={campaignBody}
                    onChange={(event) => setCampaignBody(event.target.value)}
                    placeholder="Write the announcement you want to send to confirmed subscribers."
                    rows={10}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {editingNewCampaign || !selectedCampaign
                        ? "New draft"
                        : `Editing draft updated ${formatDate(selectedCampaign.updatedAt)}`}
                    </span>
                    <span>
                      {currentCampaignRecipientEstimate} confirmed recipients currently
                      match this audience
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={saveCampaignDraft}
                    disabled={
                      campaignActionMutation.isPending ||
                      !campaignSubject.trim() ||
                      !campaignBody.trim()
                    }
                  >
                    {campaignActionMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving draft
                      </>
                    ) : selectedCampaignId && !editingNewCampaign ? (
                      "Save draft"
                    ) : (
                      "Create draft"
                    )}
                  </Button>
                  {selectedCampaignId && !editingNewCampaign ? (
                    <Button
                      variant="outline"
                      disabled={campaignActionMutation.isPending}
                      onClick={() => setDeleteCampaignId(selectedCampaignId)}
                    >
                      Delete draft
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Subscribers</CardTitle>
              <p className="text-sm text-muted-foreground">
                Search, review, and export the current audience list.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={exportCurrentRows}>
                Export current rows
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  pluginInfoQuery.refetch();
                  summaryQuery.refetch();
                  campaignsQuery.refetch();
                  subscribersQuery.refetch();
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={subscriberStatus}
                  onValueChange={(value) => {
                    setSubscriberStatus(
                      value as
                        | "all"
                        | "pending"
                        | "confirmed"
                        | "unsubscribed"
                        | "bounced"
                        | "complained",
                    );
                    setOffset(0);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                    <SelectItem value="bounced">Bounced</SelectItem>
                    <SelectItem value="complained">Complained</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Search</Label>
                <Input
                  value={search}
                  placeholder="Search email or name"
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setOffset(0);
                  }}
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Subscriber</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-left font-medium">Updated</th>
                    <th className="px-3 py-2 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers?.rows.length ? (
                    subscribers.rows.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-3 align-top">
                          <div className="font-medium">{row.email}</div>
                          {row.name ? (
                            <div className="text-xs text-muted-foreground">{row.name}</div>
                          ) : null}
                          {row.utmSource || row.utmCampaign ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {row.utmSource || "direct"}
                              {row.utmCampaign ? ` / ${row.utmCampaign}` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <Badge variant="secondary">{row.status}</Badge>
                        </td>
                        <td className="px-3 py-3 align-top text-muted-foreground">
                          <div>{row.sourceHost || "n/a"}</div>
                          {row.sourcePath ? (
                            <div className="text-xs">{row.sourcePath}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-top text-muted-foreground">
                          {formatDate(row.updatedAt)}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-wrap gap-2">
                            {row.status === "pending" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={actionMutation.isPending}
                                  onClick={() =>
                                    actionMutation.mutate({
                                      slug: projectSlug,
                                      pluginId: typedPluginId,
                                      actionId: "resend_confirmation",
                                      args: [row.email],
                                    })
                                  }
                                >
                                  Resend
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={actionMutation.isPending}
                                  onClick={() =>
                                    actionMutation.mutate({
                                      slug: projectSlug,
                                      pluginId: typedPluginId,
                                      actionId: "mark_confirmed",
                                      args: [row.email],
                                    })
                                  }
                                >
                                  Confirm
                                </Button>
                              </>
                            ) : null}
                            {row.status !== "unsubscribed" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={actionMutation.isPending}
                                onClick={() => setUnsubscribeEmail(row.email)}
                              >
                                Unsubscribe
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-10 text-center text-sm text-muted-foreground"
                      >
                        {isLoading ? "Loading subscribers..." : "No subscribers found."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {subscribers?.total ?? 0} rows total, page {currentPage} of {pageCount}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOffset(offset + limit)}
                  disabled={!subscribers || offset + limit >= subscribers.total}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Install</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">HTML</p>
                <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                  {pluginInfo?.snippets?.html || "Enable the plugin to generate a snippet."}
                </pre>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Astro</p>
                <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                  {pluginInfo?.snippets?.astro || "Enable the plugin to generate a snippet."}
                </pre>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Subscribe endpoint</p>
                <p className="text-sm font-medium break-all">
                  {pluginInfo?.usage?.subscribeEndpoint || "n/a"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expected fields</p>
                <p className="text-sm font-medium">
                  {pluginInfo?.usage?.expectedFields?.join(", ") || "n/a"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Auto source hosts</p>
                <p className="text-sm font-medium break-words">
                  {pluginInfo?.usage?.inferredAutoSourceHosts?.join(", ") || "n/a"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select
                  value={mode}
                  onValueChange={(value) =>
                    setMode(value as "newsletter" | "waitlist")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newsletter">Newsletter</SelectItem>
                    <SelectItem value="waitlist">Waitlist</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Collect name</Label>
                <Select
                  value={collectName ? "yes" : "no"}
                  onValueChange={(value) => setCollectName(value === "yes")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">Email only</SelectItem>
                    <SelectItem value="yes">Email + name</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Source hosts</Label>
                <Textarea
                  value={sourceHostsInput}
                  onChange={(event) => setSourceHostsInput(event.target.value)}
                  placeholder="example.com"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Comma- or newline-separated allowlist. Leave empty to use inferred project hosts.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Redirect allowlist</Label>
                <Textarea
                  value={redirectHostsInput}
                  onChange={(event) => setRedirectHostsInput(event.target.value)}
                  placeholder="example.com"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Allowed hosts for `_redirect` and confirmation page redirects.
                </p>
              </div>
            </div>
            <Button onClick={saveConfig} disabled={saveConfigMutation.isPending}>
              {saveConfigMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving
                </>
              ) : (
                "Save settings"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
      <AlertDialog
        open={Boolean(deleteCampaignId)}
        onOpenChange={(open) => {
          if (!open && !campaignActionMutation.isPending) {
            setDeleteCampaignId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the saved draft. No subscriber emails have been sent by
              this draft yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={campaignActionMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={campaignActionMutation.isPending || !deleteCampaignId}
              onClick={(event) => {
                event.preventDefault();
                confirmDeleteCampaign();
              }}
            >
              {campaignActionMutation.isPending ? "Deleting..." : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(unsubscribeEmail)}
        onOpenChange={(open) => {
          if (!open && !actionMutation.isPending) {
            setUnsubscribeEmail(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsubscribe subscriber?</AlertDialogTitle>
            <AlertDialogDescription>
              {unsubscribeEmail
                ? `${unsubscribeEmail} will be marked as unsubscribed immediately. If they want back in, they will need to submit the signup form again and confirm from their email.`
                : "This subscriber will be marked as unsubscribed immediately."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={actionMutation.isPending || !unsubscribeEmail}
              onClick={(event) => {
                event.preventDefault();
                confirmUnsubscribe();
              }}
            >
              {actionMutation.isPending ? "Unsubscribing..." : "Unsubscribe"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPageShell>
  );
}
