import { type ChangeEvent, useMemo, useState } from "react";
import { Plug, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";
import { trpc, type RouterInputs, type RouterOutputs } from "@/lib/trpc";
import { useAppConfig } from "@/lib/AppConfigContext";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AccessStateFilter = "all" | "enabled" | "disabled" | "suspended";
type ProjectAccessRow = RouterOutputs["superadmin"]["pluginsListAccess"]["rows"][number];
type PluginAccessRow = ProjectAccessRow["plugins"][number];
type PluginCatalogEntry =
  RouterOutputs["superadmin"]["getInstanceSettings"]["pluginCatalog"][number];
type UpsertEntitlementInput = RouterInputs["superadmin"]["pluginsUpsertEntitlement"];
type PluginState = UpsertEntitlementInput["state"];

const PROJECT_PAGE_SIZE = 100;

function formatDate(value: Date | string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatStateBadgeVariant(
  state: "enabled" | "disabled" | "suspended",
): "success" | "secondary" | "outline" {
  if (state === "enabled") return "success";
  if (state === "suspended") return "secondary";
  return "outline";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function PluginsTab() {
  const { config } = useAppConfig();
  const isExperimentalSoloInstall =
    config.installProfile === "solo" && config.experimentalSoloModeEnabled;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Plugin Access
        </CardTitle>
        <CardDescription>
          {isExperimentalSoloInstall
            ? "Experimental self-host defaults for the whole instance. Project-specific plugin configuration still lives on each project."
            : "Central hosted-platform controls for project-level plugin access and rollout."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isExperimentalSoloInstall ? (
          <div className="mb-4 rounded-lg border bg-muted/15 p-4 text-sm text-muted-foreground">
            Solo self-host mode is enabled as an internal experimental path. Plugin
            defaults here should be treated as compatibility behavior, not the primary
            product model.
          </div>
        ) : null}
        {isExperimentalSoloInstall ? (
          <InstancePluginDefaultsPanel />
        ) : (
          <ProjectsPluginAccessPanel />
        )}
      </CardContent>
    </Card>
  );
}

function InstancePluginDefaultsPanel() {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.superadmin.getInstanceSettings.useQuery();
  const updateSettings = trpc.superadmin.updateInstanceSettings.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.superadmin.getInstanceSettings.invalidate(),
        utils.config.getAppConfig.invalidate(),
      ]);
    },
  });

  if (settingsQuery.isLoading) {
    return <LoadingSpinner message="Loading plugin defaults..." className="justify-start" />;
  }

  if (settingsQuery.error || !settingsQuery.data) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Failed to load instance plugin defaults: {getErrorMessage(settingsQuery.error)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {settingsQuery.data.pluginCatalog.map((plugin: PluginCatalogEntry) => {
        const enabled =
          settingsQuery.data?.pluginDefaults[plugin.pluginId]?.enabled ?? false;
        return (
          <div
            key={plugin.pluginId}
            className="rounded-lg border bg-muted/15 p-4 space-y-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{plugin.name}</div>
                <div className="text-sm text-muted-foreground">{plugin.description}</div>
              </div>
              <Badge variant={enabled ? "success" : "secondary"}>
                {enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={enabled ? "success" : "outline"}
                disabled={updateSettings.isPending}
                onClick={() =>
                  updateSettings.mutate(
                    {
                      pluginDefaults: {
                        [plugin.pluginId]: { enabled: true },
                      },
                    },
                    {
                      onSuccess: () => {
                        toast.success(`${plugin.name} enabled`);
                      },
                      onError: (error) => {
                        toast.error(`Failed to update ${plugin.name}`, {
                          description: error.message,
                        });
                      },
                    },
                  )
                }
              >
                Enable
              </Button>
              <Button
                size="sm"
                variant={!enabled ? "secondary" : "outline"}
                disabled={updateSettings.isPending}
                onClick={() =>
                  updateSettings.mutate(
                    {
                      pluginDefaults: {
                        [plugin.pluginId]: { enabled: false },
                      },
                    },
                    {
                      onSuccess: () => {
                        toast.success(`${plugin.name} disabled`);
                      },
                      onError: (error) => {
                        toast.error(`Failed to update ${plugin.name}`, {
                          description: error.message,
                        });
                      },
                    },
                  )
                }
              >
                Disable
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectsPluginAccessPanel() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<AccessStateFilter>("all");
  const [page, setPage] = useState(1);

  const queryInput = useMemo(
    () => ({
      search: search.trim() ? search.trim() : undefined,
      limit: 500,
      offset: 0,
    }),
    [search],
  );

  const listAccessQuery = trpc.superadmin.pluginsListAccess.useQuery(queryInput);
  const upsertMutation = trpc.superadmin.pluginsUpsertEntitlement.useMutation();

  const projectRows = useMemo<ProjectAccessRow[]>(() => {
    return (listAccessQuery.data?.rows ?? []).filter((project) =>
      stateFilter === "all"
        ? true
        : project.plugins.some((row) => row.state === stateFilter),
    );
  }, [listAccessQuery.data?.rows, stateFilter]);

  const isLoading = listAccessQuery.isLoading;
  const isFetching = listAccessQuery.isFetching;
  const totalProjects = projectRows.length;
  const totalPages = Math.max(1, Math.ceil(totalProjects / PROJECT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStartIndex = (currentPage - 1) * PROJECT_PAGE_SIZE;
  const pageEndIndex = pageStartIndex + PROJECT_PAGE_SIZE;
  const pagedProjectRows = projectRows.slice(pageStartIndex, pageEndIndex);

  const refreshAll = async () => {
    await listAccessQuery.refetch();
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    setPage(1);
  };

  const handleStateFilterChange = (value: string) => {
    setStateFilter(value as AccessStateFilter);
    setPage(1);
  };

  const runSingleUpdate = async (
    input: UpsertEntitlementInput,
    successMessage: string,
  ) => {
    try {
      await upsertMutation.mutateAsync(input);
      await utils.superadmin.pluginsListAccess.invalidate();
      toast.success(successMessage);
    } catch (error) {
      toast.error("Failed to update plugin access", {
        description: getErrorMessage(error),
      });
    }
  };

  const runBulkUpdate = async (
    inputs: UpsertEntitlementInput[],
    successMessage: string,
  ) => {
    if (inputs.length === 0) return;

    try {
      await Promise.all(inputs.map((input) => upsertMutation.mutateAsync(input)));
      await utils.superadmin.pluginsListAccess.invalidate();
      toast.success(successMessage);
    } catch (error) {
      toast.error("Failed to update one or more plugins", {
        description: getErrorMessage(error),
      });
    }
  };

  const updateState = async (row: PluginAccessRow, state: PluginState) => {
    await runSingleUpdate(
      {
        pluginId: row.pluginId,
        organizationId: row.organizationId,
        scope: "project",
        projectSlug: row.projectSlug,
        state,
        monthlyEventLimit: row.monthlyEventLimit,
        hardStop: row.hardStop,
        turnstileEnabled: row.catalog.supportsTurnstile ? row.turnstileEnabled : false,
        notes: `Updated from Super Admin Plugins tab (${row.catalog.name}, ${state})`,
        ensurePluginWhenEnabled: true,
      },
      `Updated ${row.catalog.name} for ${row.projectSlug}`,
    );
  };

  const setAllProjectPluginsState = async (
    project: ProjectAccessRow,
    state: PluginState,
  ) => {
    const inputs: UpsertEntitlementInput[] = project.plugins.map((row) => ({
      pluginId: row.pluginId,
      organizationId: row.organizationId,
      scope: "project",
      projectSlug: row.projectSlug,
      state,
      monthlyEventLimit: row.monthlyEventLimit,
      hardStop: row.hardStop,
      turnstileEnabled: row.catalog.supportsTurnstile ? row.turnstileEnabled : false,
      notes: `Bulk update from Super Admin Plugins tab (${state})`,
      ensurePluginWhenEnabled: true,
    }));

    await runBulkUpdate(
      inputs,
      `Set all plugins on ${project.projectSlug} to ${state}`,
    );
  };

  const updateLimit = async (row: PluginAccessRow) => {
    const current = row.monthlyEventLimit == null ? "" : String(row.monthlyEventLimit);
    const raw = window.prompt(row.catalog.limitPrompt, current);
    if (raw === null) return;

    const trimmed = raw.trim();
    if (!trimmed) {
      await runSingleUpdate(
        {
          pluginId: row.pluginId,
          organizationId: row.organizationId,
          scope: "project",
          projectSlug: row.projectSlug,
          state: row.state,
          monthlyEventLimit: null,
          hardStop: row.hardStop,
          turnstileEnabled: row.catalog.supportsTurnstile ? row.turnstileEnabled : false,
          notes: `Set to unlimited from Super Admin Plugins tab (${row.catalog.name})`,
          ensurePluginWhenEnabled: false,
        },
        `Updated ${row.catalog.name} limit for ${row.projectSlug}`,
      );
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Limit must be a non-negative number");
      return;
    }

    await runSingleUpdate(
      {
        pluginId: row.pluginId,
        organizationId: row.organizationId,
        scope: "project",
        projectSlug: row.projectSlug,
        state: row.state,
        monthlyEventLimit: Math.floor(parsed),
        hardStop: row.hardStop,
        turnstileEnabled: row.catalog.supportsTurnstile ? row.turnstileEnabled : false,
        notes: `Updated monthly limit from Super Admin Plugins tab (${row.catalog.name})`,
        ensurePluginWhenEnabled: false,
      },
      `Updated ${row.catalog.name} limit for ${row.projectSlug}`,
    );
  };

  const updateTurnstile = async (row: PluginAccessRow, enabled: boolean) => {
    if (!row.catalog.supportsTurnstile) return;

    await runSingleUpdate(
      {
        pluginId: row.pluginId,
        organizationId: row.organizationId,
        scope: "project",
        projectSlug: row.projectSlug,
        state: row.state,
        monthlyEventLimit: row.monthlyEventLimit,
        hardStop: row.hardStop,
        turnstileEnabled: enabled,
        notes: enabled
          ? "Enabled Turnstile from Super Admin Plugins tab"
          : "Disabled Turnstile from Super Admin Plugins tab",
        ensurePluginWhenEnabled: false,
      },
      `${enabled ? "Enabled" : "Disabled"} Turnstile for ${row.projectSlug}`,
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        One row per project. Manage all plugin entitlements for that project in one
        place, including row-level actions to set all plugins at once.
      </p>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <Input
          value={search}
          onChange={handleSearchChange}
          placeholder="Search org or project..."
          className="md:max-w-sm"
        />
        <Select
          value={stateFilter}
          onValueChange={handleStateFilterChange}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by state" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="enabled">Enabled</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void refreshAll()} disabled={isFetching}>
          <RefreshCcw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {listAccessQuery.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Failed to load plugin access: {listAccessQuery.error.message}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Organization</th>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">Deployment</th>
              <th className="px-3 py-2 font-medium">Plugins</th>
              <th className="px-3 py-2 font-medium">Set all plugins</th>
              <th className="px-3 py-2 font-medium">Last update</th>
            </tr>
          </thead>
          <tbody>
            {pagedProjectRows.map((project) => (
              <tr
                key={`${project.organizationId}:${project.projectSlug}`}
                className="border-t align-top"
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{project.organizationName}</div>
                  <div className="text-xs text-muted-foreground">
                    {project.organizationSlug}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{project.projectSlug}</div>
                  <div className="text-xs text-muted-foreground">
                    {project.projectTitle || "(untitled)"}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {project.isDeployed ? (
                    <div>
                      <Badge variant="success">Deployed</Badge>
                      <div className="text-xs text-muted-foreground break-all">
                        {project.deployedDomain}
                      </div>
                    </div>
                  ) : (
                    <Badge variant="outline">Not deployed</Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="min-w-[620px] space-y-2">
                    {project.plugins.map((pluginRow) => (
                      <div
                        key={pluginRow.pluginId}
                        className="rounded-md border bg-muted/15 p-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{pluginRow.catalog.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {pluginRow.catalog.description}
                            </div>
                          </div>
                          <Badge variant={formatStateBadgeVariant(pluginRow.state)}>
                            {pluginRow.state}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {pluginRow.catalog.usageLabel}: {pluginRow.usageThisMonth} · Limit:{" "}
                          {pluginRow.monthlyEventLimit == null
                            ? "Unlimited"
                            : pluginRow.monthlyEventLimit}{" "}
                          · Scope: {pluginRow.effectiveScope} · Instance:{" "}
                          {pluginRow.projectPluginStatus || "-"} · Updated:{" "}
                          {formatDate(pluginRow.updatedAt)}
                        </div>
                        {pluginRow.catalog.supportsTurnstile ? (
                          <div className="mt-1 text-xs">
                            {pluginRow.turnstileEnabled ? (
                              pluginRow.state !== "enabled" ? (
                                <Badge variant="secondary">Turnstile On (inactive)</Badge>
                              ) : (
                                <Badge
                                  variant={
                                    pluginRow.turnstileReady ? "success" : "secondary"
                                  }
                                >
                                  {pluginRow.turnstileReady
                                    ? "Turnstile Enabled"
                                    : "Turnstile Syncing"}
                                </Badge>
                              )
                            ) : (
                              <Badge variant="outline">Turnstile Off</Badge>
                            )}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant={
                              pluginRow.state === "enabled" ? "success" : "outline"
                            }
                            disabled={upsertMutation.isPending}
                            onClick={() => void updateState(pluginRow, "enabled")}
                          >
                            Enable
                          </Button>
                          <Button
                            size="sm"
                            variant={
                              pluginRow.state === "disabled" ? "secondary" : "outline"
                            }
                            disabled={upsertMutation.isPending}
                            onClick={() => void updateState(pluginRow, "disabled")}
                          >
                            Disable
                          </Button>
                          <Button
                            size="sm"
                            variant={
                              pluginRow.state === "suspended" ? "secondary" : "outline"
                            }
                            disabled={upsertMutation.isPending}
                            onClick={() => void updateState(pluginRow, "suspended")}
                          >
                            Suspend
                          </Button>
                          {pluginRow.catalog.supportsMonthlyLimit ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={upsertMutation.isPending}
                              onClick={() => void updateLimit(pluginRow)}
                            >
                              Limit
                            </Button>
                          ) : null}
                          {pluginRow.catalog.supportsTurnstile ? (
                            <Button
                              size="sm"
                              variant={
                                pluginRow.turnstileEnabled ? "secondary" : "outline"
                              }
                              disabled={upsertMutation.isPending}
                              onClick={() =>
                                void updateTurnstile(
                                  pluginRow,
                                  !pluginRow.turnstileEnabled,
                                )
                              }
                            >
                              {pluginRow.turnstileEnabled
                                ? "Turnstile Off"
                                : "Turnstile On"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex min-w-[170px] flex-col gap-1">
                    <Button
                      size="sm"
                      variant="success"
                      disabled={upsertMutation.isPending}
                      onClick={() => void setAllProjectPluginsState(project, "enabled")}
                    >
                      Enable all plugins
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={upsertMutation.isPending}
                      onClick={() => void setAllProjectPluginsState(project, "disabled")}
                    >
                      Disable all plugins
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={upsertMutation.isPending}
                      onClick={() => void setAllProjectPluginsState(project, "suspended")}
                    >
                      Suspend all plugins
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2">{formatDate(project.updatedAt)}</td>
              </tr>
            ))}
            {pagedProjectRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {isLoading ? (
                    <LoadingSpinner message="Loading plugin access..." />
                  ) : (
                    "No projects match the current filters."
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 border rounded-md px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {totalProjects === 0
            ? "Showing 0 projects"
            : `Showing ${pageStartIndex + 1}-${Math.min(pageEndIndex, totalProjects)} of ${totalProjects} projects`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage <= 1 || isFetching}
            onClick={() => setPage((existing) => Math.max(1, existing - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage >= totalPages || isFetching}
            onClick={() =>
              setPage((existing) => Math.min(totalPages, existing + 1))
            }
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
