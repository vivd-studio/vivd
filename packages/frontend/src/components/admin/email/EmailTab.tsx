import { useEffect, useState, type ChangeEvent } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";
import { trpc } from "@/lib/trpc";
import {
  Badge,
  Button,
  Callout,
  CalloutDescription,
  CalloutTitle,
  Checkbox,
  Input,
  Label,
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatTile,
  StatTileLabel,
  StatTileValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vivd/ui";


type BrandingState = {
  displayName: string;
  logoUrl: string;
  supportEmail: string;
  websiteUrl: string;
  legalName: string;
  legalAddress: string;
  imprintUrl: string;
  privacyUrl: string;
  termsUrl: string;
};

function emptyBrandingState(): BrandingState {
  return {
    displayName: "",
    logoUrl: "",
    supportEmail: "",
    websiteUrl: "",
    legalName: "",
    legalAddress: "",
    imprintUrl: "",
    privacyUrl: "",
    termsUrl: "",
  };
}

function toBrandingState(
  value:
    | Partial<{
        displayName: string;
        logoUrl: string;
        supportEmail: string;
        websiteUrl: string;
        legalName: string;
        legalAddress: string;
        imprintUrl: string;
        privacyUrl: string;
        termsUrl: string;
      }>
    | undefined,
): BrandingState {
  return {
    displayName: value?.displayName ?? "",
    logoUrl: value?.logoUrl ?? "",
    supportEmail: value?.supportEmail ?? "",
    websiteUrl: value?.websiteUrl ?? "",
    legalName: value?.legalName ?? "",
    legalAddress: value?.legalAddress ?? "",
    imprintUrl: value?.imprintUrl ?? "",
    privacyUrl: value?.privacyUrl ?? "",
    termsUrl: value?.termsUrl ?? "",
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function EmailTab() {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.superadmin.emailDeliverabilityOverview.useQuery();
  const overview = overviewQuery.data;

  const [autoSuppressBounces, setAutoSuppressBounces] = useState(true);
  const [autoSuppressComplaints, setAutoSuppressComplaints] = useState(true);
  const [complaintRateThresholdPercent, setComplaintRateThresholdPercent] =
    useState("0.1");
  const [bounceRateThresholdPercent, setBounceRateThresholdPercent] = useState("5");
  const [branding, setBranding] = useState<BrandingState>(emptyBrandingState);

  useEffect(() => {
    if (!overview) return;
    setAutoSuppressBounces(overview.policy.autoSuppressBounces);
    setAutoSuppressComplaints(overview.policy.autoSuppressComplaints);
    setComplaintRateThresholdPercent(
      String(overview.policy.complaintRateThresholdPercent),
    );
    setBounceRateThresholdPercent(String(overview.policy.bounceRateThresholdPercent));
    setBranding(toBrandingState(overview.templateBranding));
  }, [overview]);

  const updatePolicyMutation =
    trpc.superadmin.emailDeliverabilityUpdatePolicy.useMutation({
      onSuccess: async () => {
        toast.success("Email deliverability policy updated");
        await utils.superadmin.emailDeliverabilityOverview.invalidate();
      },
      onError: (error) => {
        toast.error("Failed to update policy", {
          description: error.message,
        });
      },
    });

  const unsuppressMutation =
    trpc.superadmin.emailDeliverabilityUnsuppressRecipient.useMutation({
      onSuccess: async () => {
        toast.success("Recipient unsuppressed");
        await utils.superadmin.emailDeliverabilityOverview.invalidate();
      },
      onError: (error) => {
        toast.error("Failed to unsuppress recipient", {
          description: error.message,
        });
      },
    });

  const updateBrandingMutation =
    trpc.superadmin.emailTemplateBrandingUpdate.useMutation({
      onSuccess: async () => {
        toast.success("Email identity updated");
        await utils.superadmin.emailDeliverabilityOverview.invalidate();
      },
      onError: (error) => {
        toast.error("Failed to update email identity", {
          description: error.message,
        });
      },
    });

  const handleSavePolicy = () => {
    const complaintThreshold = Number.parseFloat(complaintRateThresholdPercent);
    if (!Number.isFinite(complaintThreshold) || complaintThreshold < 0 || complaintThreshold > 100) {
      toast.error("Complaint threshold must be between 0 and 100");
      return;
    }

    const bounceThreshold = Number.parseFloat(bounceRateThresholdPercent);
    if (!Number.isFinite(bounceThreshold) || bounceThreshold < 0 || bounceThreshold > 100) {
      toast.error("Bounce threshold must be between 0 and 100");
      return;
    }

    updatePolicyMutation.mutate({
      autoSuppressBounces,
      autoSuppressComplaints,
      complaintRateThresholdPercent: complaintThreshold,
      bounceRateThresholdPercent: bounceThreshold,
    });
  };

  const handleSaveBranding = () => {
    updateBrandingMutation.mutate({
      displayName: branding.displayName.trim() || null,
      logoUrl: branding.logoUrl.trim() || null,
      supportEmail: branding.supportEmail.trim() || null,
      websiteUrl: branding.websiteUrl.trim() || null,
      legalName: branding.legalName.trim() || null,
      legalAddress: branding.legalAddress.trim() || null,
      imprintUrl: branding.imprintUrl.trim() || null,
      privacyUrl: branding.privacyUrl.trim() || null,
      termsUrl: branding.termsUrl.trim() || null,
    });
  };

  const handleBrandingChange =
    (field: keyof BrandingState) => (event: ChangeEvent<HTMLInputElement>) => {
      setBranding((current) => ({
        ...current,
        [field]: event.target.value,
      }));
    };

  const usesMinimalFooter = Object.values(branding).every(
    (value) => value.trim().length === 0,
  );

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader>
          <PanelTitle>Email Identity</PanelTitle>
          <PanelDescription>
            Optional branding and legal footer for transactional emails. Leave fields
            blank to keep the default email footer minimal.
          </PanelDescription>
        </PanelHeader>
        <PanelContent className="space-y-4">
          <Panel tone="sunken">
            <PanelContent className="pt-5 text-sm text-muted-foreground">
            {usesMinimalFooter
              ? "No email identity details configured. Transactional emails will stay minimal and omit footer/legal details."
              : "Configured values below will be used in transactional email headers and footers for this instance."}
            </PanelContent>
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email-brand-display-name">Display name</Label>
              <Input
                id="email-brand-display-name"
                value={branding.displayName}
                placeholder="Example Studio"
                onChange={handleBrandingChange("displayName")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-brand-logo-url">Logo URL</Label>
              <Input
                id="email-brand-logo-url"
                value={branding.logoUrl}
                placeholder="https://example.com/logo.png"
                onChange={handleBrandingChange("logoUrl")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-brand-support-email">Support email</Label>
              <Input
                id="email-brand-support-email"
                value={branding.supportEmail}
                placeholder="support@example.com"
                onChange={handleBrandingChange("supportEmail")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-brand-website-url">Website URL</Label>
              <Input
                id="email-brand-website-url"
                value={branding.websiteUrl}
                placeholder="https://example.com"
                onChange={handleBrandingChange("websiteUrl")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-brand-legal-name">Legal entity name</Label>
              <Input
                id="email-brand-legal-name"
                value={branding.legalName}
                placeholder="Example GmbH"
                onChange={handleBrandingChange("legalName")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-brand-legal-address">Postal address</Label>
              <Input
                id="email-brand-legal-address"
                value={branding.legalAddress}
                placeholder="Street 1, 12345 City"
                onChange={handleBrandingChange("legalAddress")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-brand-imprint-url">Legal notice URL</Label>
              <Input
                id="email-brand-imprint-url"
                value={branding.imprintUrl}
                placeholder="https://example.com/imprint"
                onChange={handleBrandingChange("imprintUrl")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-brand-privacy-url">Privacy URL</Label>
              <Input
                id="email-brand-privacy-url"
                value={branding.privacyUrl}
                placeholder="https://example.com/privacy"
                onChange={handleBrandingChange("privacyUrl")}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="email-brand-terms-url">Terms URL</Label>
              <Input
                id="email-brand-terms-url"
                value={branding.termsUrl}
                placeholder="https://example.com/terms"
                onChange={handleBrandingChange("termsUrl")}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveBranding}
              disabled={updateBrandingMutation.isPending}
            >
              {updateBrandingMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save email identity"
              )}
            </Button>
          </div>
        </PanelContent>
      </Panel>

      <Panel>
        <PanelHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <PanelTitle>Email Deliverability</PanelTitle>
              <PanelDescription>
                Global bounce/complaint suppression and feedback handling across email
                providers.
              </PanelDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => void overviewQuery.refetch()}
              disabled={overviewQuery.isFetching}
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </PanelHeader>
        <PanelContent className="space-y-4">
          {overviewQuery.error ? (
            <Callout tone="danger">
              <CalloutTitle>Failed to load email deliverability overview</CalloutTitle>
              <CalloutDescription>
                {overviewQuery.error.message}
              </CalloutDescription>
            </Callout>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile>
              <StatTileLabel>Email provider</StatTileLabel>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="default">{overview?.provider.name || "unknown"}</Badge>
                <Badge variant={overview?.provider.webhookSecretConfigured ? "default" : "secondary"}>
                  {overview?.provider.webhookSecretConfigured
                    ? "Webhook secret set"
                    : "No webhook secret"}
                </Badge>
              </div>
            </StatTile>

            <StatTile>
              <StatTileLabel>Suppressed recipients</StatTileLabel>
              <StatTileValue className="mt-1">
                {formatInteger(overview?.metrics.suppressedRecipientCount ?? 0)}
              </StatTileValue>
            </StatTile>

            <StatTile>
              <StatTileLabel>Bounce events</StatTileLabel>
              <StatTileValue className="mt-1">
                {formatInteger(overview?.metrics.bounceEventCount ?? 0)}
              </StatTileValue>
            </StatTile>

            <StatTile>
              <StatTileLabel>Complaint events</StatTileLabel>
              <StatTileValue className="mt-1">
                {formatInteger(overview?.metrics.complaintEventCount ?? 0)}
              </StatTileValue>
            </StatTile>
          </div>

          <Panel tone="sunken">
            <PanelContent className="space-y-3 pt-5">
            <h3 className="text-sm font-medium">Feedback webhooks</h3>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Resend endpoint</p>
              <code className="text-xs break-all">
                {overview?.webhookEndpoints.resend || "Unavailable"}
              </code>
              <p className="text-xs text-muted-foreground">
                Use this URL for Resend webhook events. Set{" "}
                <code>RESEND_WEBHOOK_SECRET</code> from the Resend signing secret.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">SES endpoint</p>
              <code className="text-xs break-all">
                {overview?.webhookEndpoints.ses || "Unavailable"}
              </code>
              <p className="text-xs text-muted-foreground">
                Configure SES/SNS Bounce + Complaint notifications here. Optional:
                append <code>?secret=...</code> when using{" "}
                <code>VIVD_SES_FEEDBACK_WEBHOOK_SECRET</code>.
              </p>
              <p className="text-xs text-muted-foreground">
                Auto-confirm subscriptions: {overview?.provider.autoConfirmSubscriptionsEnabled ? "enabled" : "disabled"}
              </p>
            </div>
            </PanelContent>
          </Panel>

          <Panel tone="sunken">
            <PanelContent className="space-y-3 pt-5">
            <h3 className="text-sm font-medium">Global policy</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="deliverability-auto-suppress-bounces"
                    checked={autoSuppressBounces}
                    onCheckedChange={(value: boolean | "indeterminate") =>
                      setAutoSuppressBounces(value === true)
                    }
                  />
                  <Label
                    htmlFor="deliverability-auto-suppress-bounces"
                    className="font-normal"
                  >
                    Auto-suppress bounced recipients
                  </Label>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="deliverability-auto-suppress-complaints"
                    checked={autoSuppressComplaints}
                    onCheckedChange={(value: boolean | "indeterminate") =>
                      setAutoSuppressComplaints(value === true)
                    }
                  />
                  <Label
                    htmlFor="deliverability-auto-suppress-complaints"
                    className="font-normal"
                  >
                    Auto-suppress complaint recipients
                  </Label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="deliverability-complaint-threshold">
                    Complaint threshold (%)
                  </Label>
                  <Input
                    id="deliverability-complaint-threshold"
                    value={complaintRateThresholdPercent}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setComplaintRateThresholdPercent(event.target.value)
                    }
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="deliverability-bounce-threshold">
                    Bounce threshold (%)
                  </Label>
                  <Input
                    id="deliverability-bounce-threshold"
                    value={bounceRateThresholdPercent}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setBounceRateThresholdPercent(event.target.value)
                    }
                    inputMode="decimal"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSavePolicy}
                disabled={updatePolicyMutation.isPending}
              >
                {updatePolicyMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save policy"
                )}
              </Button>
            </div>
            </PanelContent>
          </Panel>

          <Panel tone="sunken">
            <PanelContent className="space-y-3 pt-5">
            <h3 className="text-sm font-medium">Suppressed recipients</h3>
            {overviewQuery.isLoading ? (
              <LoadingSpinner
                message="Loading deliverability state..."
                className="justify-start"
              />
            ) : overview && overview.suppressedRecipients.length > 0 ? (
              <Panel tone="sunken" className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3">Email</TableHead>
                      <TableHead className="px-3">Reason</TableHead>
                      <TableHead className="px-3">Provider</TableHead>
                      <TableHead className="px-3">Last seen</TableHead>
                      <TableHead className="px-3">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.suppressedRecipients.map((entry) => (
                      <TableRow key={`${entry.email}-${entry.reason}`}>
                        <TableCell className="px-3 py-2 text-xs break-all">{entry.email}</TableCell>
                        <TableCell className="px-3 py-2 capitalize">{entry.reason}</TableCell>
                        <TableCell className="px-3 py-2">{entry.provider}</TableCell>
                        <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDateTime(entry.lastRecordedAt)}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={unsuppressMutation.isPending}
                            onClick={() =>
                              unsuppressMutation.mutate({ email: entry.email })
                            }
                          >
                            Unsuppress
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            ) : (
              <p className="text-sm text-muted-foreground">No suppressed recipients yet.</p>
            )}
            </PanelContent>
          </Panel>

          <Panel tone="sunken">
            <PanelContent className="space-y-3 pt-5">
            <h3 className="text-sm font-medium">Recent feedback events</h3>
            {overview && overview.recentEvents.length > 0 ? (
              <Panel tone="sunken" className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3">Time</TableHead>
                      <TableHead className="px-3">Type</TableHead>
                      <TableHead className="px-3">Recipient</TableHead>
                      <TableHead className="px-3">Provider</TableHead>
                      <TableHead className="px-3">Scope</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.recentEvents.map((event, index) => (
                      <TableRow key={`${event.email}-${event.occurredAt}-${index}`}>
                        <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDateTime(event.occurredAt)}
                        </TableCell>
                        <TableCell className="px-3 py-2 capitalize">{event.type}</TableCell>
                        <TableCell className="px-3 py-2 text-xs break-all">{event.email}</TableCell>
                        <TableCell className="px-3 py-2">{event.provider}</TableCell>
                        <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                          {event.organizationId && event.projectSlug
                            ? `${event.organizationId}/${event.projectSlug}`
                            : "Global"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            ) : (
              <p className="text-sm text-muted-foreground">No feedback events received yet.</p>
            )}
            </PanelContent>
          </Panel>
        </PanelContent>
      </Panel>
    </div>
  );
}
