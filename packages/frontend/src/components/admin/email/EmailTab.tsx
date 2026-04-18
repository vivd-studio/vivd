import { useEffect, useState, type ChangeEvent } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      <Card>
        <CardHeader>
          <CardTitle>Email Identity</CardTitle>
          <CardDescription>
            Optional branding and legal footer for transactional emails. Leave fields
            blank to keep the default email footer minimal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            {usesMinimalFooter
              ? "No email identity details configured. Transactional emails will stay minimal and omit footer/legal details."
              : "Configured values below will be used in transactional email headers and footers for this instance."}
          </div>

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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Email Deliverability</CardTitle>
              <CardDescription>
                Global bounce/complaint suppression and feedback handling across email
                providers.
              </CardDescription>
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
        </CardHeader>
        <CardContent className="space-y-4">
          {overviewQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load email deliverability overview: {overviewQuery.error.message}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <section className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">Email provider</p>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="default">{overview?.provider.name || "unknown"}</Badge>
                <Badge variant={overview?.provider.webhookSecretConfigured ? "default" : "secondary"}>
                  {overview?.provider.webhookSecretConfigured
                    ? "Webhook secret set"
                    : "No webhook secret"}
                </Badge>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">Suppressed recipients</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {formatInteger(overview?.metrics.suppressedRecipientCount ?? 0)}
              </p>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">Bounce events</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {formatInteger(overview?.metrics.bounceEventCount ?? 0)}
              </p>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">Complaint events</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {formatInteger(overview?.metrics.complaintEventCount ?? 0)}
              </p>
            </section>
          </div>

          <section className="rounded-lg border bg-card p-4 space-y-3">
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
          </section>

          <section className="rounded-lg border bg-card p-4 space-y-3">
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
          </section>

          <section className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-medium">Suppressed recipients</h3>
            {overviewQuery.isLoading ? (
              <LoadingSpinner
                message="Loading deliverability state..."
                className="justify-start"
              />
            ) : overview && overview.suppressedRecipients.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">Reason</th>
                      <th className="px-3 py-2 font-medium">Provider</th>
                      <th className="px-3 py-2 font-medium">Last seen</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.suppressedRecipients.map((entry) => (
                      <tr key={`${entry.email}-${entry.reason}`} className="border-t">
                        <td className="px-3 py-2 text-xs break-all">{entry.email}</td>
                        <td className="px-3 py-2 capitalize">{entry.reason}</td>
                        <td className="px-3 py-2">{entry.provider}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDateTime(entry.lastRecordedAt)}
                        </td>
                        <td className="px-3 py-2">
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No suppressed recipients yet.</p>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-medium">Recent feedback events</h3>
            {overview && overview.recentEvents.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Recipient</th>
                      <th className="px-3 py-2 font-medium">Provider</th>
                      <th className="px-3 py-2 font-medium">Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recentEvents.map((event, index) => (
                      <tr key={`${event.email}-${event.occurredAt}-${index}`} className="border-t">
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDateTime(event.occurredAt)}
                        </td>
                        <td className="px-3 py-2 capitalize">{event.type}</td>
                        <td className="px-3 py-2 text-xs break-all">{event.email}</td>
                        <td className="px-3 py-2">{event.provider}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {event.organizationId && event.projectSlug
                            ? `${event.organizationId}/${event.projectSlug}`
                            : "Global"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No feedback events received yet.</p>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
