import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  RefreshCcw,
  Server,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type StudioMachine =
  RouterOutputs["superadmin"]["listStudioMachines"]["machines"][number];
type SortKey = "identity" | "state" | "age" | "image" | "machine";
type SortDirection = "asc" | "desc";

function formatDate(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}

function formatAge(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  const ms = Date.now() - date.getTime();
  if (!Number.isFinite(ms) || ms < 0) return "unknown";

  const minutes = Math.floor(ms / (60 * 1000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatMachineSizing(machine: StudioMachine): string {
  const parts: string[] = [];
  if (machine.cpuKind) parts.push(machine.cpuKind);
  if (typeof machine.cpus === "number") {
    parts.push(`${machine.cpus} vCPU${machine.cpus === 1 ? "" : "s"}`);
  }
  if (typeof machine.memoryMb === "number") parts.push(`${machine.memoryMb} MiB`);
  return parts.length > 0 ? parts.join(" / ") : "unknown";
}

function badgeVariantForState(state: string | null): "default" | "secondary" | "outline" {
  if (!state) return "outline";
  if (state === "started") return "default";
  if (state === "suspended") return "secondary";
  if (state === "stopped") return "outline";
  return "secondary";
}

const machineStateRank: Record<string, number> = {
  started: 0,
  starting: 1,
  replacing: 2,
  suspended: 3,
  stopping: 4,
  stopped: 5,
  destroying: 6,
  destroyed: 7,
  created: 8,
  unknown: 9,
};

function machineCreatedAtMs(machine: StudioMachine): number {
  if (!machine.createdAt) return 0;
  const ms = Date.parse(machine.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function canParkMachine(state: string | null): boolean {
  const normalized = (state || "unknown").toLowerCase();
  return !["suspended", "stopped", "stopping", "destroying", "destroyed"].includes(
    normalized,
  );
}

export function MachinesTab() {
  const utils = trpc.useUtils();
  const [confirmReconcileOpen, setConfirmReconcileOpen] = useState(false);
  const [destroyCandidate, setDestroyCandidate] = useState<StudioMachine | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("age");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const machinesQuery = trpc.superadmin.listStudioMachines.useQuery(undefined, {
    staleTime: 5_000,
  });

  const imageOptionsQuery = trpc.superadmin.getStudioMachineImageOptions.useQuery(undefined, {
    staleTime: 60_000,
  });

  const setImageOverrideMutation = trpc.superadmin.setStudioMachineImageOverrideTag.useMutation({
    onSuccess: async (data) => {
      if (!data.updated) {
        toast.error("Update skipped", {
          description: ("error" in data && data.error) || "Unable to update image selection",
        });
        return;
      }

      toast.success("Studio image selection updated");
      await Promise.all([
        utils.superadmin.getStudioMachineImageOptions.invalidate(),
        utils.superadmin.listStudioMachines.invalidate(),
      ]);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Update failed", {
        description: message,
      });
    },
  });

  const reconcileMutation = trpc.superadmin.reconcileStudioMachines.useMutation({
    onSuccess: async (data) => {
      if (!data.reconciled || !("result" in data)) {
        toast.error("Reconcile skipped", {
          description:
            ("error" in data && data.error) ||
            "Studio machine provider does not support reconciliation",
        });
        return;
      }

      const result = data.result;
      toast.success("Reconcile completed", {
        description: `Warmed ${result.warmedOutdatedImages} reconciled • destroyed ${result.destroyedOldMachines} inactive • errors ${result.errors.length}${result.dryRun ? " (dry-run)" : ""}`,
      });
      await utils.superadmin.listStudioMachines.invalidate();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Reconcile failed", {
        description: message,
      });
    },
  });

  const parkMutation = trpc.superadmin.parkStudioMachine.useMutation({
    onSuccess: async (data, variables) => {
      if (!data.parked || !("state" in data)) {
        toast.error("Parking skipped", {
          description:
            ("error" in data && data.error) ||
            "Studio machine provider does not support machine parking",
        });
        return;
      }

      const parkedLabel = data.state === "suspended" ? "suspended" : "stopped";
      toast.success(`${machineLabel} ${parkedLabel}`, {
        description: variables.machineId,
      });
      await utils.superadmin.listStudioMachines.invalidate();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Parking failed", {
        description: message,
      });
    },
  });

  const destroyMutation = trpc.superadmin.destroyStudioMachine.useMutation({
    onSuccess: async (data, variables) => {
      if (!data.destroyed) {
        toast.error("Destroy skipped", {
          description:
            ("error" in data && data.error) ||
            "Studio machine provider does not support machine destruction",
        });
        return;
      }

      toast.success(`${machineLabel} destroyed`, {
        description: variables.machineId,
      });
      await utils.superadmin.listStudioMachines.invalidate();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Destroy failed", {
        description: message,
      });
    },
    onSettled: () => {
      setDestroyCandidate(null);
    },
  });

  const machines = useMemo(() => machinesQuery.data?.machines ?? [], [machinesQuery.data?.machines]);
  const provider = machinesQuery.data?.provider ?? "unknown";
  const machineLabel = provider === "docker" ? "Container" : "Machine";
  const parkActionLabel = provider === "docker" ? "Stop" : "Suspend";
  const activeParkMachineId = parkMutation.variables?.machineId ?? null;
  const effectiveDesiredImage = machines[0]?.desiredImage || null;
  const desiredImage =
    effectiveDesiredImage ||
    (imageOptionsQuery.data && imageOptionsQuery.data.supported
      ? imageOptionsQuery.data.desiredImage
      : null);
  const listError =
    machinesQuery.data && "error" in machinesQuery.data
      ? machinesQuery.data.error
      : null;

  const stats = useMemo(() => {
    const byState = new Map<string, number>();
    let outdated = 0;
    for (const machine of machines) {
      const key = (machine.state || "unknown").toLowerCase();
      byState.set(key, (byState.get(key) || 0) + 1);
      if (machine.imageOutdated) outdated++;
    }
    return { byState, outdated };
  }, [machines]);

  const sortedMachines = useMemo(() => {
    const rows = [...machines];
    const direction = sortDirection === "asc" ? 1 : -1;

    rows.sort((left, right) => {
      let compare = 0;

      if (sortKey === "identity") {
        const leftIdentity =
          `${left.organizationId}/${left.projectSlug}/v${left.version}`.toLowerCase();
        const rightIdentity =
          `${right.organizationId}/${right.projectSlug}/v${right.version}`.toLowerCase();
        compare = leftIdentity.localeCompare(rightIdentity);
      } else if (sortKey === "state") {
        const leftRank = machineStateRank[(left.state || "unknown").toLowerCase()] ?? 99;
        const rightRank = machineStateRank[(right.state || "unknown").toLowerCase()] ?? 99;
        compare = leftRank - rightRank;
      } else if (sortKey === "age") {
        compare = machineCreatedAtMs(left) - machineCreatedAtMs(right);
      } else if (sortKey === "image") {
        compare = Number(left.imageOutdated) - Number(right.imageOutdated);
        if (compare === 0) {
          compare = (left.image || "").localeCompare(right.image || "");
        }
      } else if (sortKey === "machine") {
        compare = (left.id || "").localeCompare(right.id || "");
      }

      if (compare !== 0) return compare * direction;
      return machineCreatedAtMs(right) - machineCreatedAtMs(left);
    });

    return rows;
  }, [machines, sortDirection, sortKey]);

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "age" ? "desc" : "asc");
  };

  const sortIconFor = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-60" />;
    if (sortDirection === "asc") return <ChevronUp className="h-3 w-3" />;
    return <ChevronDown className="h-3 w-3" />;
  };

  const imageOptions = imageOptionsQuery.data;
  const latestCandidateDiffers =
    !!imageOptions?.supported &&
    !!imageOptions.latestImage &&
    !!desiredImage &&
    imageOptions.latestImage !== desiredImage;
  const imageSelectorDisabled =
    !imageOptions?.supported ||
    imageOptions.selectionMode === "unsupported" ||
    imageOptions.selectionMode === "env" ||
    setImageOverrideMutation.isPending;
  const currentImageSelectorValue =
    imageOptions?.supported && imageOptions.selectionMode === "pinned" && imageOptions.overrideTag
      ? imageOptions.overrideTag
      : imageOptions?.supported && imageOptions.selectionMode === "env"
        ? "__env__"
        : "__latest__";

  const selectorItems = useMemo(() => {
    if (!imageOptions?.supported) return [];

    const items: Array<{ value: string; label: string; description?: string }> = [];

    const latestLabel = "Latest (auto)";
    const latestDescription = imageOptions.latestImage
      ? `Resolves to ${imageOptions.latestImage}`
      : "Resolves from GHCR semver tags";
    items.push({ value: "__latest__", label: latestLabel, description: latestDescription });

    if (imageOptions.selectionMode === "env" && imageOptions.envOverrideImage) {
      items.push({
        value: "__env__",
        label: "Locked (env)",
        description: imageOptions.envOverrideImage,
      });
    }

    const knownTags = new Set<string>();
    for (const entry of imageOptions.images) {
      knownTags.add(entry.tag);
      items.push({
        value: entry.tag,
        label: entry.tag,
        description: entry.image,
      });
    }

    if (
      imageOptions.selectionMode === "pinned" &&
      imageOptions.overrideTag &&
      !knownTags.has(imageOptions.overrideTag)
    ) {
      items.splice(1, 0, {
        value: imageOptions.overrideTag,
        label: imageOptions.overrideTag,
        description: "Pinned tag (not in fetched list)",
      });
    }

    return items;
  }, [imageOptions]);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-blue-600" />
              Studio Machines
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => machinesQuery.refetch()}
                disabled={machinesQuery.isFetching}
                className="gap-2"
              >
                {machinesQuery.isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmReconcileOpen(true)}
                disabled={reconcileMutation.isPending}
              >
                {reconcileMutation.isPending ? "Reconciling..." : "Reconcile now"}
              </Button>
            </div>
          </div>
          <div className="mt-2 space-y-2">
            <div className="text-sm text-muted-foreground">
              Provider: <code>{provider}</code>
              {desiredImage ? (
                <>
                  <span className="mx-2">•</span>
                  Effective desired image: <code className="break-all">{desiredImage}</code>
                </>
              ) : null}
            </div>

            {imageOptions?.supported ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Studio image:</span>
                  <Select
                    value={currentImageSelectorValue}
                    onValueChange={(value) => {
                      if (value === "__env__") return;
                      if (value === "__latest__") {
                        setImageOverrideMutation.mutate({ tag: null });
                        return;
                      }
                      setImageOverrideMutation.mutate({ tag: value });
                    }}
                    disabled={imageSelectorDisabled}
                  >
                    <SelectTrigger className="w-[360px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {selectorItems.map((item) => (
                        <SelectItem
                          key={item.value}
                          value={item.value}
                          disabled={item.value === "__env__"}
                        >
                          <div className="flex flex-col">
                            <span>{item.label}</span>
                            {item.description ? (
                              <span className="text-xs text-muted-foreground break-all">
                                {item.description}
                              </span>
                            ) : null}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {setImageOverrideMutation.isPending ? (
                    <span className="text-xs text-muted-foreground">Updating…</span>
                  ) : null}
                </div>

                <div className="text-xs text-muted-foreground">
                  Latest resolves to the highest semver tag in{" "}
                  <code className="break-all">{imageOptions.repository}</code> (dev-* tags are also listed).
                  {latestCandidateDiffers && imageOptions.latestImage ? (
                    <span>
                      {" "}
                      Latest candidate from GHCR:{" "}
                      <code className="break-all">{imageOptions.latestImage}</code>.
                    </span>
                  ) : null}
                  {imageOptions.error ? (
                    <span className="text-red-500">
                      {" "}
                      Failed to fetch tags: {imageOptions.error}
                    </span>
                  ) : null}
                  {imageOptions.selectionMode === "env" &&
                  imageOptions.envOverrideImage &&
                  imageOptions.envOverrideVarName ? (
                    <span>
                      {" "}
                      Selector is locked because{" "}
                      <code>{imageOptions.envOverrideVarName}</code> is set.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {listError ? (
            <div className="text-sm text-red-500">
              Failed to list machines: {listError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">total {machines.length}</Badge>
            <Badge variant="outline">outdated {stats.outdated}</Badge>
            {Array.from(stats.byState.entries())
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([state, count]) => (
                <Badge key={state} variant="outline">
                  {state} {count}
                </Badge>
              ))}
          </div>

          {machinesQuery.isLoading ? (
            <div className="flex justify-center p-10">
              <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
            </div>
          ) : machines.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No studio machines found.
            </div>
          ) : (
            <div className="rounded-lg border bg-card overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("identity")}
                      >
                        Org / Project
                        {sortIconFor("identity")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("state")}
                      >
                        State
                        {sortIconFor("state")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("age")}
                      >
                        Age
                        {sortIconFor("age")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium">Placement</th>
                    <th className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("image")}
                      >
                        Image
                        {sortIconFor("image")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort("machine")}
                      >
                        {machineLabel}
                        {sortIconFor("machine")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMachines.map((m: StudioMachine) => (
                    <tr key={m.id} className="border-t align-top">
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs break-all">{m.organizationId}</div>
                        <div className="text-sm">
                          <span className="font-medium">{m.projectSlug}</span>
                          <span className="text-muted-foreground"> / v{m.version}</span>
                        </div>
                        {m.url ? (
                          <a
                            className="text-xs text-blue-600 hover:underline break-all"
                            href={m.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {m.url}
                          </a>
                        ) : (
                          <div className="text-xs text-muted-foreground">no url</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={badgeVariantForState(m.state)}>
                          {m.state || "unknown"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div>{formatAge(m.createdAt)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatDate(m.createdAt)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">
                          {m.region || (m.routePath ? "single-host" : "unknown")}
                        </div>
                        {m.routePath ? (
                          <div className="font-mono text-[11px] text-muted-foreground mt-1 break-all">
                            {m.routePath}
                          </div>
                        ) : null}
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {formatMachineSizing(m)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={m.imageOutdated ? "destructive" : "secondary"}>
                          {m.imageOutdated ? "outdated" : "ok"}
                        </Badge>
                        <div className="font-mono text-[11px] text-muted-foreground break-all mt-1">
                          {m.image || "unknown"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs break-all">{m.id}</div>
                        {m.name ? (
                          <div className="text-[11px] text-muted-foreground break-all mt-1">
                            {m.name}
                          </div>
                        ) : null}
                        {typeof m.externalPort === "number" ? (
                          <div className="text-[11px] text-muted-foreground mt-1">
                            port {m.externalPort}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => parkMutation.mutate({ machineId: m.id })}
                            disabled={parkMutation.isPending || !canParkMachine(m.state)}
                          >
                            {parkMutation.isPending && activeParkMachineId === m.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Pause className="h-3.5 w-3.5" />
                            )}
                            {m.state === "suspended"
                              ? "Suspended"
                              : m.state === "stopped"
                                ? "Stopped"
                                : parkActionLabel}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="gap-2"
                            onClick={() => setDestroyCandidate(m)}
                            disabled={destroyMutation.isPending}
                          >
                            {destroyMutation.isPending &&
                            destroyCandidate?.id === m.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Destroy
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmReconcileOpen} onOpenChange={setConfirmReconcileOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconcile studio machines?</AlertDialogTitle>
            <AlertDialogDescription>
              This runs the same backend reconciler logic:
              <br />
              - reconcile non-running machine drift (image/resources/access token)
              <br />
              - warm reconciled machines (recreate → start → wait for /health → stop)
              <br />- destroy machines not visited for the configured max inactivity window
              {provider === "fly" ? (
                <>
                  <br />- note: Fly machine region is immutable; destroy/recreate to move regions
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReconcileOpen(false);
                reconcileMutation.mutate();
              }}
            >
              Run reconcile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!destroyCandidate}
        onOpenChange={(open) => {
          if (!open && !destroyMutation.isPending) {
            setDestroyCandidate(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Destroy studio machine?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the runtime first (to allow sync), then destroy it.
              {destroyCandidate ? (
                <>
                  <br />
                  <br />
                  <span className="font-mono text-xs break-all">
                    {destroyCandidate.id}
                  </span>
                  <br />
                  {destroyCandidate.organizationId}/{destroyCandidate.projectSlug}/v
                  {destroyCandidate.version}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={destroyMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!destroyCandidate || destroyMutation.isPending}
              onClick={() => {
                if (!destroyCandidate) return;
                destroyMutation.mutate({ machineId: destroyCandidate.id });
              }}
            >
              {destroyMutation.isPending
                ? "Destroying..."
                : `Destroy ${machineLabel.toLowerCase()}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
