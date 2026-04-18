import type { ChangeEvent } from "react";
import { HardDriveDownload, Loader2, RefreshCcw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InstanceSoftware = RouterOutputs["superadmin"]["getInstanceSoftware"];
type InstanceNetwork = RouterOutputs["superadmin"]["getInstanceSettings"]["network"];
type NetworkTlsMode = "managed" | "external" | "off";

type InstanceRuntimeAdminSectionProps = {
  selfHostAdminFeaturesVisible: boolean;
  software: InstanceSoftware | undefined;
  softwareIsLoading: boolean;
  softwareIsFetching: boolean;
  waitingForUpdate: boolean;
  waitingTargetLabel: string;
  currentSoftwareLabel: string;
  latestSoftwareLabel: string;
  shortRevision: string | null;
  canTriggerManagedUpdate: boolean;
  updateButtonLabel: string;
  startSoftwareUpdatePending: boolean;
  onRefetchSoftware: () => void;
  onStartSoftwareUpdate: () => void;
  network: InstanceNetwork | undefined;
  publicHost: string;
  tlsMode: NetworkTlsMode;
  acmeEmail: string;
  networkFieldsDisabled: boolean;
  onPublicHostChange: (value: string) => void;
  onTlsModeChange: (value: NetworkTlsMode) => void;
  onAcmeEmailChange: (value: string) => void;
  onSaveNetwork: () => void;
};

export function InstanceRuntimeAdminSection({
  selfHostAdminFeaturesVisible,
  software,
  softwareIsLoading,
  softwareIsFetching,
  waitingForUpdate,
  waitingTargetLabel,
  currentSoftwareLabel,
  latestSoftwareLabel,
  shortRevision,
  canTriggerManagedUpdate,
  updateButtonLabel,
  startSoftwareUpdatePending,
  onRefetchSoftware,
  onStartSoftwareUpdate,
  network,
  publicHost,
  tlsMode,
  acmeEmail,
  networkFieldsDisabled,
  onPublicHostChange,
  onTlsModeChange,
  onAcmeEmailChange,
  onSaveNetwork,
}: InstanceRuntimeAdminSectionProps) {
  return (
    <>
      <Card
        id="instance-software"
        className="scroll-mt-6 border-border/70 shadow-sm"
      >
        <CardHeader>
          <CardTitle>Software</CardTitle>
          <CardDescription>Review the running deployment version and release status.</CardDescription>
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
                  {softwareIsLoading ? "Loading..." : latestSoftwareLabel}
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

          {selfHostAdminFeaturesVisible && software?.managedUpdate.reason ? (
            <p className="text-sm text-muted-foreground">{software.managedUpdate.reason}</p>
          ) : null}

          {waitingForUpdate ? (
            <p className="text-sm text-muted-foreground">
              Update to {waitingTargetLabel} is running. This page will stay locked until the
              backend reports the new version after restart.
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={onRefetchSoftware}
              disabled={softwareIsFetching || startSoftwareUpdatePending || waitingForUpdate}
            >
              {softwareIsFetching ? (
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
                onClick={onStartSoftwareUpdate}
                disabled={startSoftwareUpdatePending || waitingForUpdate}
              >
                {startSoftwareUpdatePending || waitingForUpdate ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {startSoftwareUpdatePending
                      ? "Starting update"
                      : `Updating to ${waitingTargetLabel}`}
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

      {selfHostAdminFeaturesVisible ? (
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle>Network</CardTitle>
            <CardDescription>
              Configure the main public host and how HTTPS is handled for this instance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="instance-network-public-host">Public host</Label>
                <Input
                  id="instance-network-public-host"
                  value={publicHost}
                  placeholder="example.com or 203.0.113.10"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    onPublicHostChange(event.target.value)
                  }
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
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    onAcmeEmailChange(event.target.value)
                  }
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
                onValueChange={(value: string) => onTlsModeChange(value as NetworkTlsMode)}
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
                Use `Bundled Caddy` on a VPS that should obtain certificates itself. Use
                `External proxy` for Dokploy, Traefik, or another upstream TLS terminator.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {network?.publicOrigin ? (
                <Badge variant="secondary">{network.publicOrigin}</Badge>
              ) : null}
              {network?.sources.publicHost === "settings" ? (
                <Badge variant="secondary">Host from Instance Settings</Badge>
              ) : null}
              {network?.sources.publicHost === "bootstrap_env" ? (
                <Badge variant="secondary">Host from bootstrap env</Badge>
              ) : null}
              {network?.deploymentManaged.publicHost ? (
                <Badge variant="outline">Deployment-managed host override active</Badge>
              ) : null}
            </div>

            {network?.deploymentManaged.publicHost ? (
              <p className="text-sm text-muted-foreground">
                A deployment-level host override is active, so the saved UI value is treated
                as fallback state until that override is removed.
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button
                onClick={onSaveNetwork}
                disabled={networkFieldsDisabled}
              >
                Save network
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
