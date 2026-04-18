import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import { Button, Callout, CalloutTitle, Field, FieldLabel, Input, Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle, Progress, StatTile, StatTileHelper, StatTileLabel, StatTileValue, StatusPill, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@vivd/ui";

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

function usageToneClass(pct: number, unlimited: boolean): string {
  if (unlimited) return "";
  if (pct >= 100) return "text-destructive";
  if (pct >= 80) return "text-amber-600 dark:text-amber-400";
  return "";
}

function progressToneClass(pct: number): string {
  if (pct >= 100) return "[&>div]:bg-destructive";
  if (pct >= 80) return "[&>div]:bg-amber-500";
  return "";
}

function UsageRow({ label, current, limit }: UsageRowProps) {
  const unlimited = isUnlimited(limit);
  const pct = safePercentage(current, limit);
  const tone = usageToneClass(pct, unlimited);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium tabular-nums ${tone}`}>
          {formatUsage(current)} / {formatLimit(limit)}
        </span>
      </div>
      {!unlimited && (
        <Progress value={pct} className={`h-1.5 ${progressToneClass(pct)}`} />
      )}
    </div>
  );
}

function UsageStatCard({ label, current, limit, helper }: UsageStatCardProps) {
  const unlimited = isUnlimited(limit);
  const pct = safePercentage(current, limit);
  const tone = usageToneClass(pct, unlimited);

  return (
    <StatTile>
      <StatTileLabel className="text-xs font-medium uppercase tracking-[0.16em]">
        {label}
      </StatTileLabel>
      <div className="flex items-end justify-between gap-3">
        <div>
          <StatTileValue className={tone}>{formatUsage(current)}</StatTileValue>
          <p className="mt-1 text-sm text-muted-foreground">
            of {formatLimit(limit)}
          </p>
        </div>
        <p
          className={`text-sm font-medium tabular-nums ${tone || "text-muted-foreground"}`}
        >
          {unlimited ? "No cap" : `${pct}%`}
        </p>
      </div>
      {!unlimited ? (
        <Progress value={pct} className={`mt-2 h-2 ${progressToneClass(pct)}`} />
      ) : (
        <div className="mt-2 h-2 rounded-full bg-muted" />
      )}
      <StatTileHelper>{helper}</StatTileHelper>
    </StatTile>
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
        <div className="text-sm text-destructive">
          Failed to load usage: {String(usageError)}
        </div>
      ) : usage ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Panel>
              <PanelHeader>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1.5">
                    <PanelTitle>Usage overview</PanelTitle>
                    <PanelDescription>
                      Live credit and resource usage for {selectedOrg.name}.
                    </PanelDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      tone={usage.limits.blocked ? "danger" : "success"}
                      dot
                    >
                      {usage.limits.blocked ? "Blocked" : "Active"}
                    </StatusPill>
                    {usage.limits.imageGenBlocked ? (
                      <StatusPill tone="warn">Image gen blocked</StatusPill>
                    ) : null}
                  </div>
                </div>
              </PanelHeader>
              <PanelContent className="space-y-4">
                {usage.limits.warnings.length > 0 ? (
                  <Callout tone="warn" icon={<AlertTriangle />}>
                    <CalloutTitle>
                      {usage.limits.warnings.length === 1
                        ? "1 active warning"
                        : `${usage.limits.warnings.length} active warnings`}
                    </CalloutTitle>
                    <ul className="list-disc space-y-1 pl-4 text-sm leading-snug text-muted-foreground">
                      {usage.limits.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </Callout>
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
              </PanelContent>
            </Panel>

            <Panel>
              <PanelHeader>
                <PanelTitle>Policy</PanelTitle>
                <PanelDescription>
                  Thresholds and caps currently applied to this organization.
                </PanelDescription>
              </PanelHeader>
              <PanelContent className="space-y-4">
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
              </PanelContent>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel>
              <PanelHeader>
                <PanelTitle>Credits</PanelTitle>
                <PanelDescription>
                  Budget windows and current credit draw.
                </PanelDescription>
              </PanelHeader>
              <PanelContent className="space-y-4">
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
              </PanelContent>
            </Panel>

            <Panel>
              <PanelHeader>
                <PanelTitle>Resources</PanelTitle>
                <PanelDescription>
                  Project slots and plugin-related monthly allowances.
                </PanelDescription>
              </PanelHeader>
              <PanelContent className="space-y-4">
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
              </PanelContent>
            </Panel>
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
                <Field>
                  <FieldLabel htmlFor="daily-credit-limit">
                    Daily credit limit
                  </FieldLabel>
                  <Input
                    id="daily-credit-limit"
                    inputMode="numeric"
                    value={limitsForm.dailyCreditLimit}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        dailyCreditLimit: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="weekly-credit-limit">
                    Weekly credit limit
                  </FieldLabel>
                  <Input
                    id="weekly-credit-limit"
                    inputMode="numeric"
                    value={limitsForm.weeklyCreditLimit}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        weeklyCreditLimit: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="monthly-credit-limit">
                    Monthly credit limit
                  </FieldLabel>
                  <Input
                    id="monthly-credit-limit"
                    inputMode="numeric"
                    value={limitsForm.monthlyCreditLimit}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        monthlyCreditLimit: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="image-gen-per-month">
                    Image generations / month
                  </FieldLabel>
                  <Input
                    id="image-gen-per-month"
                    inputMode="numeric"
                    value={limitsForm.imageGenPerMonth}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        imageGenPerMonth: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="warning-threshold">
                    Warning threshold (0-1)
                  </FieldLabel>
                  <Input
                    id="warning-threshold"
                    inputMode="decimal"
                    value={limitsForm.warningThreshold}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        warningThreshold: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="max-projects">
                    Max projects (0 = unlimited)
                  </FieldLabel>
                  <Input
                    id="max-projects"
                    inputMode="numeric"
                    value={limitsForm.maxProjects}
                    onChange={(e) =>
                      setLimitsForm((s) => ({
                        ...s,
                        maxProjects: e.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <SheetFooter>
                {Boolean(patchLimitsError) && (
                  <div className="mr-auto text-sm text-destructive">
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
