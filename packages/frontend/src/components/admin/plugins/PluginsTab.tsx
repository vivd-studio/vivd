import { type ChangeEvent, useMemo, useState } from "react";
import { MoreHorizontal, Plug, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";
import { trpc, type RouterInputs, type RouterOutputs } from "@/lib/trpc";
import { useAppConfig } from "@/lib/AppConfigContext";
import { isExperimentalSoloInstall } from "@/lib/featureFlags";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AccessStateFilter = "all" | "enabled" | "disabled" | "suspended";
type ProjectAccessRow =
  RouterOutputs["superadmin"]["pluginsListAccess"]["rows"][number];
type PluginAccessRow = ProjectAccessRow["plugins"][number];
type PluginCatalogEntry =
  RouterOutputs["superadmin"]["getInstanceSettings"]["pluginCatalog"][number];
type UpsertEntitlementInput =
  RouterInputs["superadmin"]["pluginsUpsertEntitlement"];
type PluginState = UpsertEntitlementInput["state"];
type ProjectAccessSummary = {
  enabled: number;
  disabled: number;
  suspended: number;
  projectScoped: number;
  organizationScoped: number;
  limited: number;
  turnstile: number;
};

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

function projectRowKey(
  project: Pick<ProjectAccessRow, "organizationId" | "projectSlug">,
): string {
  return `${project.organizationId}:${project.projectSlug}`;
}

function summarizeProjectAccess(
  project: ProjectAccessRow,
): ProjectAccessSummary {
  return project.plugins.reduce<ProjectAccessSummary>(
    (summary, plugin) => {
      if (plugin.state === "enabled") summary.enabled += 1;
      if (plugin.state === "disabled") summary.disabled += 1;
      if (plugin.state === "suspended") summary.suspended += 1;
      if (plugin.effectiveScope === "project") summary.projectScoped += 1;
      if (plugin.effectiveScope === "organization")
        summary.organizationScoped += 1;
      if (plugin.monthlyEventLimit != null) summary.limited += 1;
      if (plugin.turnstileEnabled) summary.turnstile += 1;
      return summary;
    },
    {
      enabled: 0,
      disabled: 0,
      suspended: 0,
      projectScoped: 0,
      organizationScoped: 0,
      limited: 0,
      turnstile: 0,
    },
  );
}

function formatProjectMix(summary: ProjectAccessSummary): string {
  return [
    `${summary.enabled} enabled`,
    `${summary.disabled} disabled`,
    summary.suspended > 0 ? `${summary.suspended} suspended` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatProjectRules(summary: ProjectAccessSummary): string {
  const parts = [
    summary.projectScoped > 0
      ? `${summary.projectScoped} project override${summary.projectScoped === 1 ? "" : "s"}`
      : null,
    summary.organizationScoped > 0
      ? `${summary.organizationScoped} org default${summary.organizationScoped === 1 ? "" : "s"}`
      : null,
    summary.limited > 0
      ? `${summary.limited} limit${summary.limited === 1 ? "" : "s"}`
      : null,
    summary.turnstile > 0 ? `${summary.turnstile} Turnstile` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "No custom rules";
}

function formatScopeLabel(scope: PluginAccessRow["effectiveScope"]): string {
  if (scope === "project") return "Project override";
  if (scope === "organization") return "Organization default";
  if (scope === "instance") return "Instance default";
  return "Not configured";
}

function formatInstanceStatus(
  status: PluginAccessRow["projectPluginStatus"],
): string {
  if (status === "enabled") return "Instance enabled";
  if (status === "disabled") return "Instance disabled";
  return "No plugin instance";
}

function confirmBulkStateChange(
  project: ProjectAccessRow,
  state: PluginState,
): boolean {
  if (state === "enabled") return true;
  return window.confirm(
    `Set all plugins on ${project.projectSlug} to ${state}? This updates ${project.plugins.length} plugin entitlement${project.plugins.length === 1 ? "" : "s"}.`,
  );
}

export function PluginsTab() {
  const { config } = useAppConfig();
  const isExperimentalSolo = isExperimentalSoloInstall(config);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Plugin Access
        </CardTitle>
        <CardDescription>
          {isExperimentalSolo
            ? "Experimental self-host compatibility defaults for the whole instance. Project-specific plugin configuration still lives on each project."
            : "Central hosted-platform controls for project-level plugin access and rollout."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isExperimentalSolo ? (
          <div className="mb-4 rounded-lg border bg-muted/15 p-4 text-sm text-muted-foreground">
            Experimental self-host compatibility is enabled as an internal path.
            Plugin defaults here should be treated as compatibility behavior,
            not the primary product model.
          </div>
        ) : null}
        {isExperimentalSolo ? (
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
    return (
      <LoadingSpinner
        message="Loading plugin defaults..."
        className="justify-start"
      />
    );
  }

  if (settingsQuery.error || !settingsQuery.data) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Failed to load instance plugin defaults:{" "}
        {getErrorMessage(settingsQuery.error)}
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
                <div className="text-sm text-muted-foreground">
                  {plugin.description}
                </div>
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
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);

  const queryInput = useMemo(
    () => ({
      search: search.trim() ? search.trim() : undefined,
      limit: 500,
      offset: 0,
    }),
    [search],
  );

  const listAccessQuery =
    trpc.superadmin.pluginsListAccess.useQuery(queryInput);
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
  const selectedProject =
    projectRows.find(
      (project) => projectRowKey(project) === selectedProjectKey,
    ) ?? null;

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

  const openProjectDetail = (project: ProjectAccessRow) => {
    setSelectedProjectKey(projectRowKey(project));
    setDetailOpen(true);
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
      await Promise.all(
        inputs.map((input) => upsertMutation.mutateAsync(input)),
      );
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
        turnstileEnabled: row.catalog.supportsTurnstile
          ? row.turnstileEnabled
          : false,
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
    if (!confirmBulkStateChange(project, state)) return;

    const inputs: UpsertEntitlementInput[] = project.plugins.map((row) => ({
      pluginId: row.pluginId,
      organizationId: row.organizationId,
      scope: "project",
      projectSlug: row.projectSlug,
      state,
      monthlyEventLimit: row.monthlyEventLimit,
      hardStop: row.hardStop,
      turnstileEnabled: row.catalog.supportsTurnstile
        ? row.turnstileEnabled
        : false,
      notes: `Bulk update from Super Admin Plugins tab (${state})`,
      ensurePluginWhenEnabled: true,
    }));

    await runBulkUpdate(
      inputs,
      `Set all plugins on ${project.projectSlug} to ${state}`,
    );
  };

  const updateLimit = async (row: PluginAccessRow) => {
    const current =
      row.monthlyEventLimit == null ? "" : String(row.monthlyEventLimit);
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
          turnstileEnabled: row.catalog.supportsTurnstile
            ? row.turnstileEnabled
            : false,
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
        turnstileEnabled: row.catalog.supportsTurnstile
          ? row.turnstileEnabled
          : false,
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
        Scan projects from the list, then inspect one project at a time to
        manage plugin access, rollout state, and plugin-specific rules in a
        focused modal.
      </p>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <Input
          value={search}
          onChange={handleSearchChange}
          placeholder="Search org or project..."
          className="md:max-w-sm"
        />
        <Select value={stateFilter} onValueChange={handleStateFilterChange}>
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
        <Button
          variant="outline"
          onClick={() => void refreshAll()}
          disabled={isFetching}
        >
          <RefreshCcw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {listAccessQuery.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Failed to load plugin access: {listAccessQuery.error.message}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border bg-background">
        <div className="flex items-center justify-between border-b bg-muted/10 px-4 py-2.5">
          <div>
            <div className="text-sm font-medium">Projects</div>
            <div className="text-xs text-muted-foreground">
              Full-width compact rows. Click any row to inspect and edit.
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {totalProjects === 0 ? "0 projects" : `${totalProjects} projects`}
          </div>
        </div>
        {pagedProjectRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground">
            {isLoading ? (
              <LoadingSpinner message="Loading plugin access..." />
            ) : (
              "No projects match the current filters."
            )}
          </div>
        ) : (
          <>
            <div className="hidden border-b bg-muted/5 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:grid lg:grid-cols-[minmax(220px,1.2fr)_minmax(170px,0.9fr)_minmax(130px,0.7fr)_minmax(260px,1fr)_minmax(220px,0.9fr)_auto] lg:gap-4">
              <span>Project</span>
              <span>Organization</span>
              <span>Deployment</span>
              <span>Plugin mix</span>
              <span>Rules / Updated</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y">
              {pagedProjectRows.map((project) => {
                const summary = summarizeProjectAccess(project);

                return (
                  <div
                    key={projectRowKey(project)}
                    className="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/10"
                  >
                    <button
                      type="button"
                      className="flex-1 rounded-sm px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => openProjectDetail(project)}
                    >
                      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(220px,1.2fr)_minmax(170px,0.9fr)_minmax(130px,0.7fr)_minmax(260px,1fr)_minmax(220px,0.9fr)] lg:items-center lg:gap-4">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {project.projectSlug}
                            <span className="ml-2 font-normal text-muted-foreground">
                              {project.projectTitle || "(untitled)"}
                            </span>
                          </div>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {project.organizationName} ·{" "}
                          {project.organizationSlug}
                        </div>
                        <div>
                          {project.isDeployed ? (
                            <Badge variant="success">Deployed</Badge>
                          ) : (
                            <Badge variant="outline">Not deployed</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatProjectMix(summary)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatProjectRules(summary)} · Updated{" "}
                          {formatDate(project.updatedAt)}
                        </div>
                      </div>
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 opacity-70 group-hover:opacity-100"
                          disabled={upsertMutation.isPending}
                          aria-label={`Bulk actions for ${project.projectSlug}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            void setAllProjectPluginsState(project, "enabled");
                          }}
                        >
                          Enable all
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            void setAllProjectPluginsState(project, "disabled");
                          }}
                        >
                          Disable all
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            void setAllProjectPluginsState(
                              project,
                              "suspended",
                            );
                          }}
                        >
                          Suspend all
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => openProjectDetail(project)}
                        >
                          Inspect project
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-hidden p-0">
          {selectedProject ? (
            <>
              <DialogHeader className="border-b bg-muted/10 px-5 py-4 text-left">
                <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span>{selectedProject.projectSlug}</span>
                  <span className="font-normal text-muted-foreground">
                    {selectedProject.projectTitle || "(untitled)"}
                  </span>
                </DialogTitle>
                <DialogDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>
                    {selectedProject.organizationName} ·{" "}
                    {selectedProject.organizationSlug}
                  </span>
                  <span>
                    {selectedProject.isDeployed
                      ? `Deployed to ${selectedProject.deployedDomain}`
                      : "Not deployed"}
                  </span>
                  <span>
                    Last update {formatDate(selectedProject.updatedAt)}
                  </span>
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-wrap gap-2 border-b px-5 py-3">
                <Badge variant="outline">
                  {formatProjectMix(summarizeProjectAccess(selectedProject))}
                </Badge>
                <Badge variant="outline">
                  {formatProjectRules(summarizeProjectAccess(selectedProject))}
                </Badge>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="success"
                    disabled={upsertMutation.isPending}
                    onClick={() =>
                      void setAllProjectPluginsState(selectedProject, "enabled")
                    }
                  >
                    Enable all
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={upsertMutation.isPending}
                    onClick={() =>
                      void setAllProjectPluginsState(
                        selectedProject,
                        "disabled",
                      )
                    }
                  >
                    Disable all
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={upsertMutation.isPending}
                    onClick={() =>
                      void setAllProjectPluginsState(
                        selectedProject,
                        "suspended",
                      )
                    }
                  >
                    Suspend all
                  </Button>
                </div>
              </div>

              <div className="max-h-[calc(85vh-145px)] overflow-y-auto">
                <div className="divide-y">
                  {selectedProject.plugins.map((pluginRow) => (
                    <div key={pluginRow.pluginId} className="px-5 py-4">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {pluginRow.catalog.name}
                            </span>
                            <Badge
                              variant={formatStateBadgeVariant(pluginRow.state)}
                            >
                              {pluginRow.state}
                            </Badge>
                            <Badge variant="outline">
                              {formatScopeLabel(pluginRow.effectiveScope)}
                            </Badge>
                            {pluginRow.catalog.supportsTurnstile ? (
                              pluginRow.turnstileEnabled ? (
                                pluginRow.state !== "enabled" ? (
                                  <Badge variant="secondary">
                                    Turnstile on (inactive)
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant={
                                      pluginRow.turnstileReady
                                        ? "success"
                                        : "secondary"
                                    }
                                  >
                                    {pluginRow.turnstileReady
                                      ? "Turnstile ready"
                                      : "Turnstile syncing"}
                                  </Badge>
                                )
                              ) : (
                                <Badge variant="outline">Turnstile off</Badge>
                              )
                            ) : null}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {pluginRow.catalog.description}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>
                              {pluginRow.catalog.usageLabel}:{" "}
                              {pluginRow.usageThisMonth}
                            </span>
                            <span>
                              Limit:{" "}
                              {pluginRow.monthlyEventLimit == null
                                ? "Unlimited"
                                : pluginRow.monthlyEventLimit}
                            </span>
                            <span>
                              {formatInstanceStatus(
                                pluginRow.projectPluginStatus,
                              )}
                            </span>
                            <span>
                              Updated {formatDate(pluginRow.updatedAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 xl:max-w-[320px] xl:justify-end">
                          <Button
                            size="sm"
                            variant={
                              pluginRow.state === "enabled"
                                ? "success"
                                : "outline"
                            }
                            disabled={upsertMutation.isPending}
                            onClick={() =>
                              void updateState(pluginRow, "enabled")
                            }
                          >
                            Enable
                          </Button>
                          <Button
                            size="sm"
                            variant={
                              pluginRow.state === "disabled"
                                ? "secondary"
                                : "outline"
                            }
                            disabled={upsertMutation.isPending}
                            onClick={() =>
                              void updateState(pluginRow, "disabled")
                            }
                          >
                            Disable
                          </Button>
                          <Button
                            size="sm"
                            variant={
                              pluginRow.state === "suspended"
                                ? "secondary"
                                : "outline"
                            }
                            disabled={upsertMutation.isPending}
                            onClick={() =>
                              void updateState(pluginRow, "suspended")
                            }
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
                                pluginRow.turnstileEnabled
                                  ? "secondary"
                                  : "outline"
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
                                ? "Turnstile off"
                                : "Turnstile on"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

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
