import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Pencil } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { LimitsForm, Organization, OrganizationUsage } from "../types";
import {
  formatLimit,
  formatUsage,
  isUnlimited,
  safePercentage,
} from "../utils";

type UsageRowProps = {
  label: string;
  current: number;
  limit: number;
};

type UsageStatCardProps = UsageRowProps & {
  helper: string;
};

function formatThresholdPercent(value: string): string {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return "-";
  return `${Math.round(parsed * 100)}%`;
}

function UsageRow({ label, current, limit }: UsageRowProps) {
  const unlimited = isUnlimited(limit);
  const pct = safePercentage(current, limit);
  const isHigh = pct >= 80;
  const isExceeded = pct >= 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={`font-medium tabular-nums ${isExceeded ? "text-destructive" : isHigh ? "text-orange-500" : ""}`}
        >
          {formatUsage(current)} / {formatLimit(limit)}
        </span>
      </div>
      {!unlimited && (
        <Progress
          value={pct}
          className={`h-1.5 ${isExceeded ? "[&>div]:bg-destructive" : isHigh ? "[&>div]:bg-orange-500" : ""}`}
        />
      )}
    </div>
  );
}

function UsageStatCard({ label, current, limit, helper }: UsageStatCardProps) {
  const unlimited = isUnlimited(limit);
  const pct = safePercentage(current, limit);
  const isHigh = pct >= 80;
  const isExceeded = pct >= 100;

  return (
    <div className="rounded-xl border bg-background/70 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p
            className={`text-2xl font-semibold tracking-tight ${
              isExceeded ? "text-destructive" : ""
            }`}
          >
            {formatUsage(current)}
          </p>
          <p className="text-sm text-muted-foreground">
            of {formatLimit(limit)}
          </p>
        </div>
        <p
          className={`text-sm font-medium tabular-nums ${
            isExceeded
              ? "text-destructive"
              : isHigh
                ? "text-orange-500"
                : "text-muted-foreground"
          }`}
        >
          {unlimited ? "No cap" : `${pct}%`}
        </p>
      </div>
      {!unlimited ? (
        <Progress
          value={pct}
          className={`mt-4 h-2 ${
            isExceeded
              ? "[&>div]:bg-destructive"
              : isHigh
                ? "[&>div]:bg-orange-500"
                : ""
          }`}
        />
      ) : (
        <div className="mt-4 h-2 rounded-full bg-muted" />
      )}
      <p className="mt-3 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

type Props = {
  selectedOrg: Organization;
  usageLoading: boolean;
  usageError: unknown;
  usage: OrganizationUsage | undefined;
  limitsForm: LimitsForm;
  setLimitsForm: Dispatch<SetStateAction<LimitsForm>>;
  patchLimitsPending: boolean;
  patchLimitsError: unknown;
  onSaveLimits: (limits: LimitsForm) => Promise<unknown> | void;
};

export function UsageLimitsPanel({
  selectedOrg,
  usageLoading,
  usageError,
  usage,
  limitsForm,
  setLimitsForm,
  patchLimitsPending,
  patchLimitsError,
  onSaveLimits,
}: Props) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="space-y-6">
      {usageLoading ? (
        <LoadingSpinner message="Loading usage..." className="justify-start" />
      ) : usageError ? (
        <div className="text-red-500">
          Failed to load usage: {String(usageError)}
        </div>
      ) : usage ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Card className="border-border/70">
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <CardTitle>Usage overview</CardTitle>
                    <CardDescription>
                      Live credit and resource usage for {selectedOrg.name}.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {usage.limits.blocked ? (
                      <Badge variant="destructive">Blocked</Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                    {usage.limits.imageGenBlocked ? (
                      <Badge variant="secondary">Image gen blocked</Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {usage.limits.warnings.length > 0 ? (
                  <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950/30">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
                        {usage.limits.warnings.length === 1
                          ? "1 active warning"
                          : `${usage.limits.warnings.length} active warnings`}
                      </p>
                      <ul className="list-disc space-y-1 pl-4 text-sm text-orange-700 dark:text-orange-400">
                        {usage.limits.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <UsageStatCard
                    label="Daily credits"
                    current={usage.limits.usage.daily.current}
                    limit={usage.limits.usage.daily.limit}
                    helper="Daily budget resets every 24 hours."
                  />
                  <UsageStatCard
                    label="Weekly credits"
                    current={usage.limits.usage.weekly.current}
                    limit={usage.limits.usage.weekly.limit}
                    helper="Weekly spend across studio activity."
                  />
                  <UsageStatCard
                    label="Monthly credits"
                    current={usage.limits.usage.monthly.current}
                    limit={usage.limits.usage.monthly.limit}
                    helper="Monthly budget for generation and edits."
                  />
                  <UsageStatCard
                    label="Projects"
                    current={usage.projectCount}
                    limit={usage.maxProjects ?? 0}
                    helper="Projects currently assigned to this org."
                  />
                  <UsageStatCard
                    label="Image generations"
                    current={usage.limits.usage.imageGen.current}
                    limit={usage.limits.usage.imageGen.limit}
                    helper="Monthly image generation allowance."
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader className="pb-4">
                <CardTitle>Policy</CardTitle>
                <CardDescription>
                  Thresholds and caps currently applied to this organization.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Credit access</span>
                    <span className="font-medium">
                      {usage.limits.blocked ? "Blocked" : "Active"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Image generation</span>
                    <span className="font-medium">
                      {usage.limits.imageGenBlocked ? "Blocked" : "Active"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Warning threshold</span>
                    <span className="font-medium">
                      {formatThresholdPercent(limitsForm.warningThreshold)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Projects cap</span>
                    <span className="font-medium">
                      {formatLimit(usage.maxProjects ?? 0)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Limits
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader className="pb-4">
                <CardTitle>Credits</CardTitle>
                <CardDescription>
                  Budget windows and current credit draw.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageRow
                  label="Daily"
                  current={usage.limits.usage.daily.current}
                  limit={usage.limits.usage.daily.limit}
                />
                <UsageRow
                  label="Weekly"
                  current={usage.limits.usage.weekly.current}
                  limit={usage.limits.usage.weekly.limit}
                />
                <UsageRow
                  label="Monthly"
                  current={usage.limits.usage.monthly.current}
                  limit={usage.limits.usage.monthly.limit}
                />
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader className="pb-4">
                <CardTitle>Resources</CardTitle>
                <CardDescription>
                  Project slots and plugin-related monthly allowances.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageRow
                  label="Projects"
                  current={usage.projectCount}
                  limit={usage.maxProjects ?? 0}
                />
                <UsageRow
                  label="Image generations (monthly)"
                  current={usage.limits.usage.imageGen.current}
                  limit={usage.limits.usage.imageGen.limit}
                />
              </CardContent>
            </Card>
          </div>

          {/* Edit Limits Sheet */}
          <Sheet open={editOpen} onOpenChange={setEditOpen}>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Edit Limits</SheetTitle>
                <SheetDescription>
                  Set to 0 for unlimited. Changes apply immediately.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-1.5">
                  <Label>Daily credit limit</Label>
                  <Input
                    inputMode="numeric"
                    value={limitsForm.dailyCreditLimit}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        dailyCreditLimit: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Weekly credit limit</Label>
                  <Input
                    inputMode="numeric"
                    value={limitsForm.weeklyCreditLimit}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        weeklyCreditLimit: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Monthly credit limit</Label>
                  <Input
                    inputMode="numeric"
                    value={limitsForm.monthlyCreditLimit}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        monthlyCreditLimit: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Image generations / month</Label>
                  <Input
                    inputMode="numeric"
                    value={limitsForm.imageGenPerMonth}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        imageGenPerMonth: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Warning threshold (0-1)</Label>
                  <Input
                    inputMode="decimal"
                    value={limitsForm.warningThreshold}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        warningThreshold: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Max projects (0 = unlimited)</Label>
                  <Input
                    inputMode="numeric"
                    value={limitsForm.maxProjects}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        maxProjects: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <SheetFooter>
                {Boolean(patchLimitsError) && (
                  <div className="text-sm text-red-500 mr-auto">
                    {String(patchLimitsError)}
                  </div>
                )}
                <Button
                  onClick={async () => {
                    try {
                      await onSaveLimits(limitsForm);
                      setEditOpen(false);
                    } catch {
                      // Mutation errors are surfaced through toast + inline state.
                    }
                  }}
                  disabled={patchLimitsPending}
                >
                  {patchLimitsPending ? "Saving..." : "Save limits"}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <div className="text-muted-foreground">No usage data available.</div>
      )}
    </div>
  );
}
