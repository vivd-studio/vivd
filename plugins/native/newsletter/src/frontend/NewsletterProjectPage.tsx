import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppConfig } from "@/lib/AppConfigContext";
import { authClient } from "@/lib/auth-client";
import { formatDocumentTitle } from "@/lib/brand";
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
} from "../shared/summary";
import { NewsletterCampaignsCard } from "./newsletterProjectPage/CampaignsCard";
import { NewsletterDialogs } from "./newsletterProjectPage/Dialogs";
import { NewsletterInstallCard } from "./newsletterProjectPage/InstallCard";
import { NewsletterSettingsCard } from "./newsletterProjectPage/SettingsCard";
import { StatCard } from "./newsletterProjectPage/shared";
import { NewsletterSubscribersCard } from "./newsletterProjectPage/SubscribersCard";
import type {
  NewsletterCampaignAudience,
  NewsletterCampaigns,
  NewsletterPluginIcon,
  NewsletterPluginInfo,
  NewsletterProjectPageProps,
  NewsletterSubscribers,
  NewsletterSummary,
} from "./newsletterProjectPage/types";
import {
  downloadCsv,
  formatListInput,
  parseListInput,
} from "./newsletterProjectPage/utils";

type NewsletterSubscriberStatus =
  | "all"
  | "pending"
  | "confirmed"
  | "unsubscribed"
  | "bounced"
  | "complained";

const SUBSCRIBER_PAGE_SIZE = 100;
const CAMPAIGN_PAGE_SIZE = 20;

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
  const [testSendEmail, setTestSendEmail] = useState("");
  const [sendCampaignId, setSendCampaignId] = useState<string | null>(null);
  const [cancelSendCampaignId, setCancelSendCampaignId] = useState<string | null>(null);
  const [subscriberStatus, setSubscriberStatus] =
    useState<NewsletterSubscriberStatus>("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [unsubscribeEmail, setUnsubscribeEmail] = useState<string | null>(null);

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
        limit: CAMPAIGN_PAGE_SIZE,
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
        limit: SUBSCRIBER_PAGE_SIZE,
        offset,
      },
    },
    { enabled: !!projectSlug },
  );

  const invalidatePluginData = async () => {
    await Promise.all([
      utils.plugins.catalog.invalidate({ slug: projectSlug }),
      utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId }),
      utils.plugins.read.invalidate(),
    ]);
  };

  const ensureMutation = trpc.plugins.ensure.useMutation({
    onSuccess: async () => {
      toast.success("Newsletter plugin enabled");
      await invalidatePluginData();
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
      await invalidatePluginData();
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
      await invalidatePluginData();
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
      } else if (result.actionId === "test_send_campaign") {
        const payload = result.result as { email?: string };
        toast.success("Campaign test sent", {
          description: payload.email
            ? `A test copy was sent to ${payload.email}.`
            : undefined,
        });
      } else if (result.actionId === "send_campaign") {
        const payload = result.result as { campaignId?: string; recipientCount?: number };
        setSendCampaignId(null);
        if (payload.campaignId) {
          setEditingNewCampaign(false);
          setCampaignSelectionMode("manual");
          setSelectedCampaignId(payload.campaignId);
        }
        toast.success("Campaign queued", {
          description:
            typeof payload.recipientCount === "number"
              ? `${payload.recipientCount} deliveries were queued for background sending.`
              : undefined,
        });
      } else if (result.actionId === "cancel_campaign") {
        setCancelSendCampaignId(null);
        toast.success("Campaign canceled");
      }

      await invalidatePluginData();
    },
    onError: (error) => {
      toast.error("Campaign action failed", {
        description: error.message,
      });
    },
  });

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

  const pluginInfo = pluginInfoQuery.data as NewsletterPluginInfo;
  const summary = summaryQuery.data?.result as NewsletterSummary;
  const campaigns = campaignsQuery.data?.result as NewsletterCampaigns;
  const subscribers = subscribersQuery.data?.result as NewsletterSubscribers;

  useEffect(() => {
    if (!pluginInfo?.config) return;
    setMode(pluginInfo.config.mode);
    setCollectName(Boolean(pluginInfo.config.collectName));
    setSourceHostsInput(formatListInput(pluginInfo.config.sourceHosts ?? []));
    setRedirectHostsInput(formatListInput(pluginInfo.config.redirectHostAllowlist ?? []));
  }, [pluginInfo?.config]);

  useEffect(() => {
    const sessionEmail =
      typeof session?.user === "object" &&
      session?.user &&
      "email" in session.user &&
      typeof session.user.email === "string"
        ? session.user.email
        : "";
    if (!testSendEmail && sessionEmail) {
      setTestSendEmail(sessionEmail);
    }
  }, [session, testSendEmail]);

  useEffect(() => {
    if (!campaigns?.rows) return;
    if (editingNewCampaign) return;

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
      setCampaignOffset(Math.max(0, campaignOffset - CAMPAIGN_PAGE_SIZE));
    }
  }, [campaignOffset, campaigns]);

  const pluginEnabled = !!pluginInfo?.enabled;
  const pluginEntitled = pluginInfo?.entitled ?? false;
  const needsEnable = pluginEntitled && !pluginEnabled && !pluginInfo?.instanceId;
  const pluginPresentation = getProjectPluginPresentation(typedPluginId, projectSlug);
  const isRequestPending = isPluginAccessRequestPending(pluginInfo?.accessRequest);
  const isLoading =
    pluginInfoQuery.isLoading ||
    summaryQuery.isLoading ||
    campaignsQuery.isLoading ||
    subscribersQuery.isLoading;

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
    return Math.max(1, Math.ceil(total / SUBSCRIBER_PAGE_SIZE));
  }, [subscribers?.total]);
  const currentPage = useMemo(
    () => Math.floor(offset / SUBSCRIBER_PAGE_SIZE) + 1,
    [offset],
  );
  const campaignPageCount = useMemo(() => {
    const total = campaigns?.total ?? 0;
    return Math.max(1, Math.ceil(total / CAMPAIGN_PAGE_SIZE));
  }, [campaigns?.total]);
  const currentCampaignPage = useMemo(
    () => Math.floor(campaignOffset / CAMPAIGN_PAGE_SIZE) + 1,
    [campaignOffset],
  );
  const selectedCampaign = useMemo(
    () => campaigns?.rows.find((row) => row.id === selectedCampaignId) ?? null,
    [campaigns?.rows, selectedCampaignId],
  );
  const campaignIsEditable =
    editingNewCampaign || !selectedCampaign || selectedCampaign.status === "draft";
  const campaignHasUnsavedEdits = Boolean(
    selectedCampaign &&
      !editingNewCampaign &&
      (selectedCampaign.subject !== campaignSubject ||
        selectedCampaign.body !== campaignBody ||
        selectedCampaign.audience !== campaignAudience),
  );
  const currentCampaignRecipientEstimate =
    campaignAudience === "mode_confirmed"
      ? (campaigns?.audienceOptions.modeConfirmed ?? 0)
      : (campaigns?.audienceOptions.allConfirmed ?? 0);

  const refreshPluginReads = () => {
    pluginInfoQuery.refetch();
    summaryQuery.refetch();
    campaignsQuery.refetch();
    subscribersQuery.refetch();
  };

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

  const updateSubscriberStatus = (value: NewsletterSubscriberStatus) => {
    setSubscriberStatus(value);
    setOffset(0);
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    setOffset(0);
  };

  const resendConfirmation = (email: string) => {
    actionMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId: "resend_confirmation",
      args: [email],
    });
  };

  const markConfirmed = (email: string) => {
    actionMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId: "mark_confirmed",
      args: [email],
    });
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

  const sendCampaignTest = () => {
    if (!selectedCampaignId || !testSendEmail.trim()) return;
    campaignActionMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId: "test_send_campaign",
      args: [selectedCampaignId, testSendEmail.trim()],
    });
  };

  const confirmQueueCampaignSend = () => {
    if (!sendCampaignId) return;
    campaignActionMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId: "send_campaign",
      args: [sendCampaignId],
    });
  };

  const confirmCancelCampaignSend = () => {
    if (!cancelSendCampaignId) return;
    campaignActionMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId: "cancel_campaign",
      args: [cancelSendCampaignId],
    });
  };

  return (
    <SettingsPageShell
      title="Newsletter / Waitlist"
      description="Capture confirmed subscribers or waitlist signups for this project."
    >
      <div className="space-y-6">
        {needsEnable ? (
          <NewsletterAccessCard
            pluginInfo={pluginInfo}
            pluginIcon={pluginPresentation.icon}
            canEnablePlugin={canEnablePlugin}
            canRequestPluginAccess={canRequestPluginAccess}
            isSessionPending={isSessionPending}
            isRequestPending={isRequestPending}
            isEnablePending={ensureMutation.isPending}
            isRequestPendingAction={requestAccessMutation.isPending}
            onEnable={() =>
              ensureMutation.mutate({ slug: projectSlug, pluginId: typedPluginId })
            }
            onRequestAccess={() =>
              requestAccessMutation.mutate({
                slug: projectSlug,
                pluginId: typedPluginId,
              })
            }
          />
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

        <NewsletterCampaignsCard
          campaigns={campaigns}
          mode={mode}
          currentCampaignPage={currentCampaignPage}
          campaignPageCount={campaignPageCount}
          campaignOffset={campaignOffset}
          campaignLimit={CAMPAIGN_PAGE_SIZE}
          selectedCampaignId={selectedCampaignId}
          selectedCampaign={selectedCampaign}
          editingNewCampaign={editingNewCampaign}
          campaignIsEditable={campaignIsEditable}
          campaignHasUnsavedEdits={campaignHasUnsavedEdits}
          currentCampaignRecipientEstimate={currentCampaignRecipientEstimate}
          campaignSubject={campaignSubject}
          campaignBody={campaignBody}
          campaignAudience={campaignAudience}
          testSendEmail={testSendEmail}
          isPending={campaignActionMutation.isPending}
          onNewDraft={startNewCampaignDraft}
          onOpenCampaign={openCampaignFromList}
          onGoToPage={goToCampaignPage}
          onSubjectChange={setCampaignSubject}
          onBodyChange={setCampaignBody}
          onAudienceChange={setCampaignAudience}
          onSaveDraft={saveCampaignDraft}
          onDeleteDraft={() => setDeleteCampaignId(selectedCampaignId)}
          onTestSendEmailChange={setTestSendEmail}
          onSendTest={sendCampaignTest}
          onQueueSend={() => setSendCampaignId(selectedCampaign?.id ?? null)}
          onCancelSend={() => setCancelSendCampaignId(selectedCampaign?.id ?? null)}
        />

        <NewsletterSubscribersCard
          projectSlug={projectSlug}
          subscribers={subscribers}
          isLoading={isLoading}
          subscriberStatus={subscriberStatus}
          search={search}
          offset={offset}
          limit={SUBSCRIBER_PAGE_SIZE}
          currentPage={currentPage}
          pageCount={pageCount}
          actionPending={actionMutation.isPending}
          onStatusChange={updateSubscriberStatus}
          onSearchChange={updateSearch}
          onExport={exportCurrentRows}
          onRefresh={refreshPluginReads}
          onOffsetChange={setOffset}
          onResend={resendConfirmation}
          onMarkConfirmed={markConfirmed}
          onStartUnsubscribe={setUnsubscribeEmail}
        />

        <NewsletterInstallCard pluginInfo={pluginInfo} />

        <NewsletterSettingsCard
          mode={mode}
          collectName={collectName}
          sourceHostsInput={sourceHostsInput}
          redirectHostsInput={redirectHostsInput}
          isPending={saveConfigMutation.isPending}
          onModeChange={setMode}
          onCollectNameChange={setCollectName}
          onSourceHostsChange={setSourceHostsInput}
          onRedirectHostsChange={setRedirectHostsInput}
          onSave={saveConfig}
        />
      </div>

      <NewsletterDialogs
        selectedCampaign={selectedCampaign}
        deleteCampaignId={deleteCampaignId}
        unsubscribeEmail={unsubscribeEmail}
        sendCampaignId={sendCampaignId}
        cancelSendCampaignId={cancelSendCampaignId}
        isActionPending={actionMutation.isPending}
        isCampaignActionPending={campaignActionMutation.isPending}
        onDeleteCampaignOpenChange={(open) => {
          if (!open && !campaignActionMutation.isPending) {
            setDeleteCampaignId(null);
          }
        }}
        onUnsubscribeOpenChange={(open) => {
          if (!open && !actionMutation.isPending) {
            setUnsubscribeEmail(null);
          }
        }}
        onSendCampaignOpenChange={(open) => {
          if (!open && !campaignActionMutation.isPending) {
            setSendCampaignId(null);
          }
        }}
        onCancelSendOpenChange={(open) => {
          if (!open && !campaignActionMutation.isPending) {
            setCancelSendCampaignId(null);
          }
        }}
        onConfirmDeleteCampaign={confirmDeleteCampaign}
        onConfirmUnsubscribe={confirmUnsubscribe}
        onConfirmQueueSend={confirmQueueCampaignSend}
        onConfirmCancelSend={confirmCancelCampaignSend}
      />
    </SettingsPageShell>
  );
}

function NewsletterAccessCard(props: {
  pluginInfo: NewsletterPluginInfo;
  pluginIcon: NewsletterPluginIcon;
  canEnablePlugin: boolean;
  canRequestPluginAccess: boolean;
  isSessionPending: boolean;
  isRequestPending: boolean;
  isEnablePending: boolean;
  isRequestPendingAction: boolean;
  onEnable: () => void;
  onRequestAccess: () => void;
}) {
  const {
    pluginInfo,
    pluginIcon: PluginIcon,
    canEnablePlugin,
    canRequestPluginAccess,
    isSessionPending,
    isRequestPending,
    isEnablePending,
    isRequestPendingAction,
    onEnable,
    onRequestAccess,
  } = props;

  return (
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
            <Button onClick={onEnable} disabled={isEnablePending}>
              {isEnablePending ? (
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
              onClick={onRequestAccess}
              disabled={isRequestPending || isRequestPendingAction}
            >
              {isRequestPendingAction ? (
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
  );
}
