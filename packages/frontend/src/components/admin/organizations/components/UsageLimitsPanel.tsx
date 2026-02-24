import type { Dispatch, SetStateAction } from "react";
import { LoadingSpinner } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { LimitsForm, Organization, OrganizationUsage } from "../types";
import { formatLimit, formatUsage, isUnlimited, safePercentage } from "../utils";

type UsageRowProps = {
  label: string;
  current: number;
  limit: number;
};

function UsageRow({ label, current, limit }: UsageRowProps) {
  const unlimited = isUnlimited(limit);
  const pct = safePercentage(current, limit);
  const isHigh = pct >= 80;
  const isExceeded = pct >= 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${isExceeded ? "text-destructive" : isHigh ? "text-orange-500" : ""}`}>
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

type Props = {
  selectedOrg: Organization;
  usageLoading: boolean;
  usageError: unknown;
  usage: OrganizationUsage | undefined;
  limitsForm: LimitsForm;
  setLimitsForm: Dispatch<SetStateAction<LimitsForm>>;
  patchLimitsPending: boolean;
  patchLimitsError: unknown;
  onSaveLimits: (limits: LimitsForm) => void;
};

export function UsageLimitsPanel({
  selectedOrg: _selectedOrg,
  usageLoading,
  usageError,
  usage,
  limitsForm,
  setLimitsForm,
  patchLimitsPending,
  patchLimitsError,
  onSaveLimits,
}: Props) {
  return (
    <div className="space-y-6">
      {usageLoading ? (
        <LoadingSpinner message="Loading usage..." className="justify-start" />
      ) : usageError ? (
        <div className="text-red-500">Failed to load usage: {String(usageError)}</div>
      ) : usage ? (
        <>
          <div className="flex items-center gap-2">
            {usage.limits.blocked ? (
              <Badge variant="destructive">Blocked</Badge>
            ) : (
              <Badge variant="default">Active</Badge>
            )}
            {usage.limits.imageGenBlocked && (
              <Badge variant="secondary">Image gen blocked</Badge>
            )}
          </div>

          {usage.limits.warnings.length > 0 && (
            <div className="rounded-md border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30 p-3">
              <ul className="list-disc pl-4 text-sm text-orange-700 dark:text-orange-400 space-y-1">
                {usage.limits.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <UsageRow
              label="Projects"
              current={usage.projectCount}
              limit={usage.maxProjects ?? 0}
            />
            <UsageRow
              label="Daily credits"
              current={usage.limits.usage.daily.current}
              limit={usage.limits.usage.daily.limit}
            />
            <UsageRow
              label="Weekly credits"
              current={usage.limits.usage.weekly.current}
              limit={usage.limits.usage.weekly.limit}
            />
            <UsageRow
              label="Monthly credits"
              current={usage.limits.usage.monthly.current}
              limit={usage.limits.usage.monthly.limit}
            />
            <UsageRow
              label="Image generations (monthly)"
              current={usage.limits.usage.imageGen.current}
              limit={usage.limits.usage.imageGen.limit}
            />
          </div>

          <Separator />

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div>
              <div className="text-sm font-medium">Edit limits</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set to 0 for unlimited. Changes apply immediately.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Daily credit limit</Label>
                <Input
                  inputMode="numeric"
                  value={limitsForm.dailyCreditLimit}
                  onChange={(e) =>
                    setLimitsForm((state) => ({ ...state, dailyCreditLimit: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Weekly credit limit</Label>
                <Input
                  inputMode="numeric"
                  value={limitsForm.weeklyCreditLimit}
                  onChange={(e) =>
                    setLimitsForm((state) => ({ ...state, weeklyCreditLimit: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Monthly credit limit</Label>
                <Input
                  inputMode="numeric"
                  value={limitsForm.monthlyCreditLimit}
                  onChange={(e) =>
                    setLimitsForm((state) => ({ ...state, monthlyCreditLimit: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Image generations / month</Label>
                <Input
                  inputMode="numeric"
                  value={limitsForm.imageGenPerMonth}
                  onChange={(e) =>
                    setLimitsForm((state) => ({ ...state, imageGenPerMonth: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Warning threshold (0-1)</Label>
                <Input
                  inputMode="decimal"
                  value={limitsForm.warningThreshold}
                  onChange={(e) =>
                    setLimitsForm((state) => ({ ...state, warningThreshold: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max projects (0 = unlimited)</Label>
                <Input
                  inputMode="numeric"
                  value={limitsForm.maxProjects}
                  onChange={(e) =>
                    setLimitsForm((state) => ({ ...state, maxProjects: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => onSaveLimits(limitsForm)}
                disabled={patchLimitsPending}
              >
                {patchLimitsPending ? "Saving..." : "Save limits"}
              </Button>
            </div>
            {Boolean(patchLimitsError) && (
              <div className="text-sm text-red-500">{String(patchLimitsError)}</div>
            )}
          </div>
        </>
      ) : (
        <div className="text-muted-foreground">No usage data available.</div>
      )}
    </div>
  );
}
