import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { HardDriveDownload, Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { RouterOutputs } from "@/lib/trpc";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppConfig } from "@/lib/AppConfigContext";

const CAPABILITY_META = [
  {
    key: "multiOrg",
    label: "Multi-organization",
    description: "Allow multiple organizations and org switching in the control plane.",
  },
  {
    key: "tenantHosts",
    label: "Tenant hosts",
    description: "Enable managed tenant hosts like {org}.<base>.",
  },
  {
    key: "customDomains",
    label: "Custom publish domains",
    description: "Allow per-organization publish domains in the registry.",
  },
  {
    key: "orgLimitOverrides",
    label: "Org limit overrides",
    description: "Allow per-organization overrides on top of instance defaults.",
  },
  {
    key: "orgPluginEntitlements",
    label: "Org plugin entitlements",
    description: "Allow organization-level plugin access overrides.",
  },
  {
    key: "projectPluginEntitlements",
    label: "Project plugin entitlements",
    description: "Allow project-level plugin access overrides.",
  },
  {
    key: "dedicatedPluginHost",
    label: "Dedicated plugin host",
    description: "Serve plugin runtime from a dedicated host instead of the same host.",
  },
] as const;

const LIMIT_FIELDS = [
  {
    key: "dailyCreditLimit",
    label: "Daily credits",
    placeholder: "Inherited",
  },
  {
    key: "weeklyCreditLimit",
    label: "Weekly credits",
    placeholder: "Inherited",
  },
  {
    key: "monthlyCreditLimit",
    label: "Monthly credits",
    placeholder: "Inherited",
  },
  {
    key: "imageGenPerMonth",
    label: "Images / month",
    placeholder: "Inherited",
  },
  {
    key: "warningThreshold",
    label: "Warning threshold",
    placeholder: "Inherited",
  },
  {
    key: "maxProjects",
    label: "Max projects",
    placeholder: "Inherited",
  },
] as const;

type CapabilityKey = (typeof CAPABILITY_META)[number]["key"];
type LimitFieldKey = (typeof LIMIT_FIELDS)[number]["key"];
type NetworkTlsMode = "managed" | "external" | "off";
type InstanceSoftware = RouterOutputs["superadmin"]["getInstanceSoftware"];
type PendingManagedUpdate = {
  targetTag: string;
  startedAt: number;
};

type CapabilityState = Record<CapabilityKey, boolean>;
type LimitState = Record<LimitFieldKey, string>;

const MANAGED_UPDATE_STORAGE_KEY = "vivd.instance-software.pending-update";
const MANAGED_UPDATE_POLL_INTERVAL_MS = 3_000;
const MANAGED_UPDATE_TIMEOUT_MS = 5 * 60_000;

function emptyLimitState(): LimitState {
  return {
    dailyCreditLimit: "",
    weeklyCreditLimit: "",
    monthlyCreditLimit: "",
    imageGenPerMonth: "",
    warningThreshold: "",
    maxProjects: "",
  };
}

function toLimitState(
  limits: Partial<Record<LimitFieldKey, number>> | undefined,
): LimitState {
  return {
    dailyCreditLimit:
      limits?.dailyCreditLimit != null ? String(limits.dailyCreditLimit) : "",
    weeklyCreditLimit:
      limits?.weeklyCreditLimit != null ? String(limits.weeklyCreditLimit) : "",
    monthlyCreditLimit:
      limits?.monthlyCreditLimit != null ? String(limits.monthlyCreditLimit) : "",
    imageGenPerMonth:
      limits?.imageGenPerMonth != null ? String(limits.imageGenPerMonth) : "",
    warningThreshold:
      limits?.warningThreshold != null ? String(limits.warningThreshold) : "",
    maxProjects: limits?.maxProjects != null ? String(limits.maxProjects) : "",
  };
}

function normalizeVersionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return trimmed;
  return `${Number.parseInt(match[1], 10)}.${Number.parseInt(match[2], 10)}.${Number.parseInt(
    match[3],
    10,
  )}`;
}

function compareNormalizedSemverLabel(left: string | null, right: string | null): number | null {
  if (!left || !right) return null;

  const leftMatch = left.match(/^(\d+)\.(\d+)\.(\d+)$/);
  const rightMatch = right.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!leftMatch || !rightMatch) return null;

  for (let index = 1; index <= 3; index += 1) {
    const delta =
      Number.parseInt(leftMatch[index], 10) - Number.parseInt(rightMatch[index], 10);
    if (delta !== 0) return delta;
  }

  return 0;
}

function doesSoftwareMatchTarget(
  software: InstanceSoftware | undefined,
  targetTag: string | null,
): boolean {
  if (!software || !targetTag) return false;

  const normalizedTarget = normalizeVersionLabel(targetTag);
  const currentCandidates = [software.currentVersion, software.currentImageTag]
    .map((value) => normalizeVersionLabel(value))
    .filter((value): value is string => !!value);

  if (normalizedTarget && currentCandidates.includes(normalizedTarget)) {
    return true;
  }

  if (
    normalizedTarget &&
    currentCandidates.some((candidate) => {
      const comparison = compareNormalizedSemverLabel(candidate, normalizedTarget);
      return comparison != null && comparison > 0;
    })
  ) {
    return true;
  }

  const normalizedLatest = normalizeVersionLabel(software.latestTag || software.latestVersion);
  if (software.releaseStatus !== "current" || !normalizedTarget) {
    return false;
  }

  if (normalizedLatest === normalizedTarget) {
    return true;
  }

  const latestComparison = compareNormalizedSemverLabel(normalizedLatest, normalizedTarget);
  return latestComparison != null && latestComparison > 0;
}

function readPendingManagedUpdate(): PendingManagedUpdate | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(MANAGED_UPDATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingManagedUpdate>;
    const targetTag = typeof parsed.targetTag === "string" ? parsed.targetTag.trim() : "";
    const startedAt =
      typeof parsed.startedAt === "number" && Number.isFinite(parsed.startedAt)
        ? parsed.startedAt
        : 0;
    if (!targetTag || startedAt <= 0) return null;
    return { targetTag, startedAt };
  } catch {
    return null;
  }
}

function writePendingManagedUpdate(pending: PendingManagedUpdate | null) {
  if (typeof window === "undefined") return;

  if (!pending) {
    window.sessionStorage.removeItem(MANAGED_UPDATE_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(MANAGED_UPDATE_STORAGE_KEY, JSON.stringify(pending));
}

export function InstanceSettingsTab() {
  const location = useLocation();
  const { config } = useAppConfig();
  const utils = trpc.useUtils();
  const settingsQuery = trpc.superadmin.getInstanceSettings.useQuery();
  const softwareQuery = trpc.superadmin.getInstanceSoftware.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });
  const refetchSoftware = softwareQuery.refetch;
  const settings = settingsQuery.data;
  const software = softwareQuery.data;

  const [capabilities, setCapabilities] = useState<CapabilityState>({
    multiOrg: true,
    tenantHosts: true,
    customDomains: true,
    orgLimitOverrides: true,
    orgPluginEntitlements: true,
    projectPluginEntitlements: true,
    dedicatedPluginHost: true,
  });
  const [limits, setLimits] = useState<LimitState>(emptyLimitState);
  const [publicHost, setPublicHost] = useState("");
  const [tlsMode, setTlsMode] = useState<NetworkTlsMode>("off");
  const [acmeEmail, setAcmeEmail] = useState("");
  const [pendingManagedUpdate, setPendingManagedUpdate] = useState<PendingManagedUpdate | null>(
    () => readPendingManagedUpdate(),
  );
  const effectiveInstallProfile = settings?.installProfile ?? null;
  const isSoloInstall = effectiveInstallProfile === "solo";
  const isPlatformInstall = effectiveInstallProfile === "platform";
  const isExperimentalSoloInstall =
    isSoloInstall && config.experimentalSoloModeEnabled;
  const waitingForUpdate = !!pendingManagedUpdate;

  useEffect(() => {
    if (!settings) return;
    setCapabilities(settings.capabilities);
    setLimits(toLimitState(settings.limitDefaults));
    setPublicHost(settings.network.publicHost ?? "");
    setTlsMode(settings.network.tlsMode);
    setAcmeEmail(settings.network.acmeEmail ?? "");
  }, [settings]);

  useEffect(() => {
    if (location.hash !== "#instance-software") return;
    document.getElementById("instance-software")?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  }, [location.hash]);

  useEffect(() => {
    if (!pendingManagedUpdate) return;
    if (!doesSoftwareMatchTarget(software, pendingManagedUpdate.targetTag)) return;

    writePendingManagedUpdate(null);
    setPendingManagedUpdate(null);
    toast.success("Update completed", {
      description: `Now running ${software?.currentVersion || software?.currentImageTag || pendingManagedUpdate.targetTag}. Reloading the page.`,
    });
    window.location.reload();
  }, [pendingManagedUpdate, software]);

  useEffect(() => {
    if (!pendingManagedUpdate) return;

    let cancelled = false;
    let timeoutId: number | null = null;

    const poll = async () => {
      if (Date.now() - pendingManagedUpdate.startedAt > MANAGED_UPDATE_TIMEOUT_MS) {
        writePendingManagedUpdate(null);
        setPendingManagedUpdate(null);
        toast.error("Update status timed out", {
          description:
            "The update did not report the target version within 5 minutes. Check the self-host logs and try again if needed.",
        });
        return;
      }

      try {
        await refetchSoftware();
      } catch {
        // Backend/frontend may be restarting. Keep polling.
      }

      if (cancelled) return;
      timeoutId = window.setTimeout(() => {
        void poll();
      }, MANAGED_UPDATE_POLL_INTERVAL_MS);
    };

    timeoutId = window.setTimeout(() => {
      void poll();
    }, MANAGED_UPDATE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [pendingManagedUpdate, refetchSoftware]);

  const updateSettings = trpc.superadmin.updateInstanceSettings.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.superadmin.getInstanceSettings.invalidate(),
        utils.config.getAppConfig.invalidate(),
      ]);
    },
  });

  const startSoftwareUpdate = trpc.superadmin.startInstanceSoftwareUpdate.useMutation({
    onSuccess: (result) => {
      if (!result.started) {
        toast.error("Update not started", {
          description: result.error,
        });
        return;
      }

      const pending = {
        targetTag: result.targetTag,
        startedAt: Date.now(),
      } satisfies PendingManagedUpdate;
      writePendingManagedUpdate(pending);
      setPendingManagedUpdate(pending);
      toast.success("Update started", {
        description: `Applying ${result.targetTag}. The update stays locked until this instance reports that version as running.`,
      });
      void refetchSoftware();
    },
    onError: (error) => {
      toast.error("Failed to start update", {
        description: error.message,
      });
    },
  });

  const topologyBadges = useMemo(() => {
    if (!settings) return [];
    return [
      settings.controlPlane.mode === "path_based" ? "Path-based control plane" : "Host-based control plane",
      settings.pluginRuntime.mode === "same_host_path"
        ? "Same-host plugins"
        : "Dedicated plugin host",
      settings.singleProjectMode ? "Single-project default" : "Multi-project default",
    ];
  }, [settings]);

  const networkFieldsDisabled =
    updateSettings.isPending || settingsQuery.isLoading || !isSoloInstall;
  const currentSoftwareLabel =
    software?.currentVersion || software?.currentImageTag || "Unknown";
  const latestSoftwareLabel =
    software?.latestVersion || software?.latestTag || "Unknown";
  const shortRevision = software?.currentRevision?.slice(0, 12) || null;
  const canTriggerManagedUpdate =
    isSoloInstall &&
    !!software?.managedUpdate.enabled &&
    !!software.latestTag &&
    software.releaseStatus !== "current";
  const updateButtonLabel =
    software?.releaseStatus === "available"
      ? `Update to ${software.latestVersion || software.latestTag}`
      : "Apply latest release";
  const waitingTargetLabel = pendingManagedUpdate?.targetTag || software?.latestVersion || software?.latestTag || "latest release";

  const handleSaveCapabilities = () => {
    updateSettings.mutate(
      { capabilities },
      {
        onSuccess: () => {
          toast.success("Capabilities updated");
        },
        onError: (error) => {
          toast.error("Failed to update capabilities", {
            description: error.message,
          });
        },
      },
    );
  };

  const handleSaveLimits = () => {
    const payload = Object.fromEntries(
      LIMIT_FIELDS.map(({ key }) => {
        const raw = limits[key].trim();
        if (!raw) return [key, null];

        const parsed = Number(raw);
        return [key, Number.isFinite(parsed) ? parsed : null];
      }),
    ) as Record<LimitFieldKey, number | null>;

    updateSettings.mutate(
      { limitDefaults: payload },
      {
        onSuccess: () => {
          toast.success("Instance limits updated");
        },
        onError: (error) => {
          toast.error("Failed to update limits", {
            description: error.message,
          });
        },
      },
    );
  };

  const handleSaveNetwork = () => {
    if (!isSoloInstall) {
      toast.error(
        "Network settings are currently editable only for experimental solo self-host installs.",
      );
      return;
    }

    updateSettings.mutate(
      {
        network: {
          publicHost: publicHost.trim() || null,
          tlsMode,
          acmeEmail: acmeEmail.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success("Network settings updated");
        },
        onError: (error) => {
          toast.error("Failed to update network settings", {
            description: error.message,
          });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            {isExperimentalSoloInstall
              ? "Review the active experimental self-host posture and routing shape for this instance."
              : "Review the active platform posture, routing shape, and instance-wide defaults."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Install profile</Label>
            {isSoloInstall ? (
              <>
                <div className="flex max-w-xs items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
                  <Badge variant="secondary">Solo</Badge>
                  <span className="text-sm text-muted-foreground">
                    Experimental self-host profile
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <code>solo</code> is enabled here only as an internal experimental
                  self-host path. <code>platform</code> remains the supported posture for
                  normal operation.
                </p>
              </>
            ) : isPlatformInstall ? (
              <>
                <div className="flex max-w-xs items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
                  <Badge variant="secondary">Platform</Badge>
                  <span className="text-sm text-muted-foreground">
                    Multi-org platform profile
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <code>platform</code> is the supported posture for this installation and
                  keeps the hosted multi-org control plane active.
                  {!config.experimentalSoloModeEnabled
                    ? " Solo self-host stays hidden unless the backend experimental flag is enabled."
                    : ""}
                </p>
              </>
            ) : (
              <div className="max-w-xs rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                Loading profile...
              </div>
            )}
          </div>

          {topologyBadges.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {topologyBadges.map((badge) => (
                <Badge key={badge} variant="secondary">
                  {badge}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card
        id="instance-software"
        className="scroll-mt-6 border-border/70 shadow-sm"
      >
        <CardHeader>
          <CardTitle>Software</CardTitle>
          <CardDescription>
            {isExperimentalSoloInstall
              ? "Review the running experimental self-host bundle version and apply newer releases when the managed updater is configured."
              : "Review the running deployment version. Platform updates stay deployment-managed for now."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Current release</Label>
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="font-medium">{currentSoftwareLabel}</div>
                <p className="text-sm text-muted-foreground">
                  {software?.currentImageTag
                    ? `Configured image tag: ${software.currentImageTag}`
                    : "The running image does not expose a release tag yet."}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Latest known release</Label>
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="font-medium">
                  {softwareQuery.isLoading ? "Loading..." : latestSoftwareLabel}
                </div>
                <p className="text-sm text-muted-foreground">
                  {software?.releaseStatus === "available"
                    ? "A newer release is available."
                    : software?.releaseStatus === "current"
                      ? "This install is already on the latest known release."
                      : "Latest release metadata is available, but the running version could not be compared reliably."}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {software?.releaseStatus === "available" ? (
              <Badge variant="secondary">Update available</Badge>
            ) : null}
            {software?.releaseStatus === "current" ? (
              <Badge variant="secondary">Up to date</Badge>
            ) : null}
            {software?.releaseStatus === "unknown" ? (
              <Badge variant="outline">Version comparison unavailable</Badge>
            ) : null}
            {shortRevision ? <Badge variant="outline">rev {shortRevision}</Badge> : null}
            {software?.currentImage ? (
              <Badge variant="outline">{software.currentImage}</Badge>
            ) : null}
          </div>

          {software?.releaseError ? (
            <p className="text-sm text-muted-foreground">
              Latest release lookup failed: {software.releaseError}
            </p>
          ) : null}

          {isSoloInstall && software?.managedUpdate.reason ? (
            <p className="text-sm text-muted-foreground">{software.managedUpdate.reason}</p>
          ) : null}

          {waitingForUpdate ? (
            <p className="text-sm text-muted-foreground">
              Update to {waitingTargetLabel} is running. This page will stay locked until the
              backend reports the new version after restart.
            </p>
          ) : null}

          {isPlatformInstall ? (
            <p className="text-sm text-muted-foreground">
              This page shows the current platform version only. Applying updates remains a
              deployment-level operation for now.
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void softwareQuery.refetch();
              }}
              disabled={softwareQuery.isFetching || startSoftwareUpdate.isPending || waitingForUpdate}
            >
              {softwareQuery.isFetching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refreshing
                </>
              ) : (
                <>
                  <RefreshCcw className="h-4 w-4" />
                  Check again
                </>
              )}
            </Button>

            {canTriggerManagedUpdate ? (
              <Button
                onClick={() => startSoftwareUpdate.mutate()}
                disabled={startSoftwareUpdate.isPending || waitingForUpdate}
              >
                {startSoftwareUpdate.isPending || waitingForUpdate ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {startSoftwareUpdate.isPending ? "Starting update" : `Updating to ${waitingTargetLabel}`}
                  </>
                ) : (
                  <>
                    <HardDriveDownload className="h-4 w-4" />
                    {updateButtonLabel}
                  </>
                )}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle>Network</CardTitle>
          <CardDescription>
            {isExperimentalSoloInstall
              ? "Configure the main public host and how HTTPS is handled for this instance."
              : "This shows the currently resolved host and TLS state. Platform host topology stays deployment-managed for now."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!isSoloInstall ? (
            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              Network settings are currently UI-managed only for the experimental{" "}
              <code>solo</code> self-host path. Keep <code>platform</code> host and TLS
              topology in deployment config until the platform-specific surface exists.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="instance-network-public-host">Public host</Label>
              <Input
                id="instance-network-public-host"
                value={publicHost}
                placeholder="example.com or 203.0.113.10"
                onChange={(event) => setPublicHost(event.target.value)}
                disabled={networkFieldsDisabled}
              />
              <p className="text-sm text-muted-foreground">
                Enter the host only. Do not include `http://` or `https://`.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="instance-network-acme-email">ACME email</Label>
              <Input
                id="instance-network-acme-email"
                value={acmeEmail}
                placeholder="admin@example.com"
                onChange={(event) => setAcmeEmail(event.target.value)}
                disabled={networkFieldsDisabled || tlsMode !== "managed"}
              />
              <p className="text-sm text-muted-foreground">
                Used only when bundled Caddy manages HTTPS certificates directly.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>HTTPS handled by</Label>
            <Select
              value={tlsMode}
              onValueChange={(value) => setTlsMode(value as NetworkTlsMode)}
              disabled={networkFieldsDisabled}
            >
              <SelectTrigger className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="managed">Bundled Caddy</SelectItem>
                <SelectItem value="external">External proxy</SelectItem>
                <SelectItem value="off">Plain HTTP</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Use `Bundled Caddy` on a VPS that should obtain certificates itself.
              Use `External proxy` for Dokploy, Traefik, or another upstream TLS terminator.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {settings?.network.publicOrigin ? (
              <Badge variant="secondary">{settings.network.publicOrigin}</Badge>
            ) : null}
            {settings?.network.sources.publicHost === "settings" ? (
              <Badge variant="secondary">Host from Instance Settings</Badge>
            ) : null}
            {settings?.network.sources.publicHost === "bootstrap_env" ? (
              <Badge variant="secondary">Host from bootstrap env</Badge>
            ) : null}
            {settings?.network.deploymentManaged.publicHost ? (
              <Badge variant="outline">Deployment-managed host override active</Badge>
            ) : null}
          </div>

          {settings?.network.deploymentManaged.publicHost ? (
            <p className="text-sm text-muted-foreground">
              A deployment-level host override is active, so the saved UI value is treated as
              fallback state until that override is removed.
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button
              onClick={handleSaveNetwork}
              disabled={networkFieldsDisabled}
            >
              Save network
            </Button>
          </div>
        </CardContent>
      </Card>

      {isPlatformInstall ? (
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle>Capabilities</CardTitle>
            <CardDescription>
              Bound the platform surface instead of relying on one large, over-configurable mode.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {CAPABILITY_META.map((entry) => (
              <label
                key={entry.key}
                className="flex items-start gap-3 rounded-lg border p-3"
              >
                <Checkbox
                  checked={capabilities[entry.key]}
                  onCheckedChange={(checked) =>
                    setCapabilities((current) => ({
                      ...current,
                      [entry.key]: checked === true,
                    }))
                  }
                />
                <div className="space-y-1">
                  <div className="font-medium">{entry.label}</div>
                  <p className="text-sm text-muted-foreground">{entry.description}</p>
                </div>
              </label>
            ))}

            <div className="flex justify-end">
              <Button
                onClick={handleSaveCapabilities}
                disabled={updateSettings.isPending || settingsQuery.isLoading}
              >
                Save capabilities
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle>Instance Limits</CardTitle>
          <CardDescription>
            These defaults sit above env bootstrap values and below any org-level overrides
            when that capability is enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {LIMIT_FIELDS.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`instance-limit-${field.key}`}>{field.label}</Label>
              <Input
                id={`instance-limit-${field.key}`}
                value={limits[field.key]}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setLimits((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
            </div>
          ))}

          <div className="md:col-span-2 flex justify-end">
            <Button
              onClick={handleSaveLimits}
              disabled={updateSettings.isPending || settingsQuery.isLoading}
            >
              Save limits
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
