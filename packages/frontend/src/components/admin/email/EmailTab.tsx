import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!overview) return;
    setAutoSuppressBounces(overview.policy.autoSuppressBounces);
    setAutoSuppressComplaints(overview.policy.autoSuppressComplaints);
    setComplaintRateThresholdPercent(
      String(overview.policy.complaintRateThresholdPercent),
    );
    setBounceRateThresholdPercent(String(overview.policy.bounceRateThresholdPercent));
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

  return (
    <div className="space-y-6">
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
            <h3 className="text-sm font-medium">SES feedback webhook</h3>
            <code className="text-xs break-all">
              {overview?.webhookEndpoints.ses || "Unavailable"}
            </code>
            <p className="text-xs text-muted-foreground">
              Configure SES/SNS Bounce + Complaint notifications to this URL. Optional:
              append <code>?secret=...</code> when using
              <code> VIVD_SES_FEEDBACK_WEBHOOK_SECRET</code>.
            </p>
            <p className="text-xs text-muted-foreground">
              Auto-confirm subscriptions: {overview?.provider.autoConfirmSubscriptionsEnabled ? "enabled" : "disabled"}
            </p>
          </section>

          <section className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-medium">Global policy</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="deliverability-auto-suppress-bounces"
                    checked={autoSuppressBounces}
                    onCheckedChange={(value) => setAutoSuppressBounces(value === true)}
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
                    onCheckedChange={(value) => setAutoSuppressComplaints(value === true)}
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
                    onChange={(event) =>
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
                    onChange={(event) => setBounceRateThresholdPercent(event.target.value)}
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
