import { type ChangeEvent, useMemo, useState } from "react";
import { Plug, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";
import { trpc, type RouterInputs, type RouterOutputs } from "@/lib/trpc";
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
type SuperAdminPluginId =
  RouterInputs["superadmin"]["pluginsUpsertEntitlement"]["pluginId"];
type PluginAccessRow = RouterOutputs["superadmin"]["pluginsListAccess"]["rows"][number];
type UpsertEntitlementInput = RouterInputs["superadmin"]["pluginsUpsertEntitlement"];
type PluginState = UpsertEntitlementInput["state"];

type PluginListConfig = {
  id: SuperAdminPluginId;
  label: string;
  description: string;
  usageLabel: string;
  limitPrompt: string;
  showTurnstile: boolean;
};

type ConsolidatedPluginRow = PluginAccessRow & {
  pluginId: SuperAdminPluginId;
  pluginLabel: string;
  pluginDescription: string;
  usageLabel: string;
  limitPrompt: string;
  showTurnstile: boolean;
};

type ProjectAccessRow = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  projectSlug: string;
  projectTitle: string;
  isDeployed: boolean;
  deployedDomain: string | null;
  pluginRows: ConsolidatedPluginRow[];
  updatedAt: Date | string | null;
};

const PROJECT_PAGE_SIZE = 100;

const SUPERADMIN_PLUGIN_LIST: ReadonlyArray<PluginListConfig> = [
  {
    id: "contact_form",
    label: "Contact Form",
    description: "Submissions with optional Turnstile protection.",
    usageLabel: "Submissions",
    limitPrompt:
      "Set monthly contact form submission limit.\nLeave empty for unlimited.",
    showTurnstile: true,
  },
  {
    id: "analytics",
    label: "Analytics",
    description: "Tracking script and event ingestion.",
    usageLabel: "Events",
    limitPrompt: "Set monthly analytics event limit.\nLeave empty for unlimited.",
    showTurnstile: false,
  },
];

function formatDate(value: Date | string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function toTimestamp(value: Date | string | null): number {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getTime();
}

function formatStateBadgeVariant(
  state: "enabled" | "disabled" | "suspended",
): "default" | "secondary" | "outline" {
  if (state === "enabled") return "default";
  if (state === "suspended") return "secondary";
  return "outline";
}

function withPluginMetadata(
  row: PluginAccessRow,
  plugin: PluginListConfig,
): ConsolidatedPluginRow {
  return {
    ...row,
    pluginId: plugin.id,
    pluginLabel: plugin.label,
    pluginDescription: plugin.description,
    usageLabel: plugin.usageLabel,
    limitPrompt: plugin.limitPrompt,
    showTurnstile: plugin.showTurnstile,
  };
}

function createFallbackPluginRow(
  project: {
    organizationId: string;
    organizationSlug: string;
    organizationName: string;
    projectSlug: string;
    projectTitle: string;
    isDeployed: boolean;
    deployedDomain: string | null;
  },
  plugin: PluginListConfig,
): ConsolidatedPluginRow {
  return {
    organizationId: project.organizationId,
    organizationSlug: project.organizationSlug,
    organizationName: project.organizationName,
    projectSlug: project.projectSlug,
    projectTitle: project.projectTitle,
    isDeployed: project.isDeployed,
    deployedDomain: project.deployedDomain,
    effectiveScope: "none",
    state: "disabled",
    managedBy: "manual_superadmin",
    monthlyEventLimit: null,
    hardStop: true,
    turnstileEnabled: false,
    turnstileReady: false,
    usageThisMonth: 0,
    projectPluginStatus: null,
    updatedAt: null,
    pluginId: plugin.id,
    pluginLabel: plugin.label,
    pluginDescription: plugin.description,
    usageLabel: plugin.usageLabel,
    limitPrompt: plugin.limitPrompt,
    showTurnstile: plugin.showTurnstile,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function PluginsTab() {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Plugin Access
        </CardTitle>
        <CardDescription>
          Central super-admin controls for project-level plugin entitlements.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProjectsPluginAccessPanel />
      </CardContent>
    </Card>
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
      state: undefined,
      limit: 500,
      offset: 0,
    }),
    [search],
  );

  const contactFormListQuery = trpc.superadmin.pluginsListAccess.useQuery({
    pluginId: "contact_form",
    ...queryInput,
  });
  const analyticsListQuery = trpc.superadmin.pluginsListAccess.useQuery({
    pluginId: "analytics",
    ...queryInput,
  });

  const upsertMutation = trpc.superadmin.pluginsUpsertEntitlement.useMutation();

  const projectRows = useMemo<ProjectAccessRow[]>(() => {
    type ProjectMapValue = {
      organizationId: string;
      organizationSlug: string;
      organizationName: string;
      projectSlug: string;
      projectTitle: string;
      isDeployed: boolean;
      deployedDomain: string | null;
      pluginRowsById: Map<SuperAdminPluginId, ConsolidatedPluginRow>;
    };

    const projectMap = new Map<string, ProjectMapValue>();

    const addRows = (plugin: PluginListConfig, rows: PluginAccessRow[]) => {
      for (const rawRow of rows) {
        const row = withPluginMetadata(rawRow, plugin);
        const key = `${row.organizationId}:${row.projectSlug}`;
        const existing = projectMap.get(key);
        if (existing) {
          existing.pluginRowsById.set(plugin.id, row);
          continue;
        }

        projectMap.set(key, {
          organizationId: row.organizationId,
          organizationSlug: row.organizationSlug,
          organizationName: row.organizationName,
          projectSlug: row.projectSlug,
          projectTitle: row.projectTitle,
          isDeployed: row.isDeployed,
          deployedDomain: row.deployedDomain,
          pluginRowsById: new Map<SuperAdminPluginId, ConsolidatedPluginRow>([
            [plugin.id, row],
          ]),
        });
      }
    };

    for (const plugin of SUPERADMIN_PLUGIN_LIST) {
      addRows(
        plugin,
        plugin.id === "contact_form"
          ? contactFormListQuery.data?.rows ?? []
          : analyticsListQuery.data?.rows ?? [],
      );
    }

    const groupedRows = Array.from(projectMap.values())
      .map((project) => {
        const pluginRows = SUPERADMIN_PLUGIN_LIST.map((plugin) => {
          return (
            project.pluginRowsById.get(plugin.id) ??
            createFallbackPluginRow(project, plugin)
          );
        });
        const updatedAt = pluginRows.reduce<Date | string | null>(
          (latest, pluginRow) =>
            toTimestamp(pluginRow.updatedAt) > toTimestamp(latest)
              ? pluginRow.updatedAt
              : latest,
          null,
        );

        return {
          organizationId: project.organizationId,
          organizationSlug: project.organizationSlug,
          organizationName: project.organizationName,
          projectSlug: project.projectSlug,
          projectTitle: project.projectTitle,
          isDeployed: project.isDeployed,
          deployedDomain: project.deployedDomain,
          pluginRows,
          updatedAt,
        };
      })
      .filter((project) =>
        stateFilter === "all"
          ? true
          : project.pluginRows.some((row) => row.state === stateFilter),
      );

    groupedRows.sort((left, right) => {
      const orgOrder = left.organizationName.localeCompare(right.organizationName);
      if (orgOrder !== 0) return orgOrder;
      return left.projectSlug.localeCompare(right.projectSlug);
    });

    return groupedRows;
  }, [
    analyticsListQuery.data?.rows,
    contactFormListQuery.data?.rows,
    stateFilter,
  ]);

  const queryErrors = useMemo(() => {
    const errors: Array<{ plugin: string; message: string }> = [];
    if (contactFormListQuery.error) {
      errors.push({
        plugin: "Contact Form",
        message: contactFormListQuery.error.message,
      });
    }
    if (analyticsListQuery.error) {
      errors.push({
        plugin: "Analytics",
        message: analyticsListQuery.error.message,
      });
    }
    return errors;
  }, [contactFormListQuery.error, analyticsListQuery.error]);

  const isLoading = contactFormListQuery.isLoading || analyticsListQuery.isLoading;
  const isFetching = contactFormListQuery.isFetching || analyticsListQuery.isFetching;
  const totalProjects = projectRows.length;
  const totalPages = Math.max(1, Math.ceil(totalProjects / PROJECT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStartIndex = (currentPage - 1) * PROJECT_PAGE_SIZE;
  const pageEndIndex = pageStartIndex + PROJECT_PAGE_SIZE;
  const pagedProjectRows = projectRows.slice(pageStartIndex, pageEndIndex);

  const refreshAll = async () => {
    await Promise.all([contactFormListQuery.refetch(), analyticsListQuery.refetch()]);
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

  const updateState = async (row: ConsolidatedPluginRow, state: PluginState) => {
    await runSingleUpdate(
      {
        pluginId: row.pluginId,
        organizationId: row.organizationId,
        scope: "project",
        projectSlug: row.projectSlug,
        state,
        monthlyEventLimit: row.monthlyEventLimit,
        hardStop: row.hardStop,
        turnstileEnabled: row.showTurnstile ? row.turnstileEnabled : false,
        notes: `Updated from Super Admin Plugins tab (${row.pluginLabel}, ${state})`,
        ensurePluginWhenEnabled: true,
      },
      `Updated ${row.pluginLabel} for ${row.projectSlug}`,
    );
  };

  const setAllProjectPluginsState = async (
    project: ProjectAccessRow,
    state: PluginState,
  ) => {
    const inputs: UpsertEntitlementInput[] = project.pluginRows.map((row) => ({
      pluginId: row.pluginId,
      organizationId: row.organizationId,
      scope: "project",
      projectSlug: row.projectSlug,
      state,
      monthlyEventLimit: row.monthlyEventLimit,
      hardStop: row.hardStop,
      turnstileEnabled: row.showTurnstile ? row.turnstileEnabled : false,
      notes: `Bulk update from Super Admin Plugins tab (${state})`,
      ensurePluginWhenEnabled: true,
    }));

    await runBulkUpdate(
      inputs,
      `Set all plugins on ${project.projectSlug} to ${state}`,
    );
  };

  const updateLimit = async (row: ConsolidatedPluginRow) => {
    const current = row.monthlyEventLimit == null ? "" : String(row.monthlyEventLimit);
    const raw = window.prompt(row.limitPrompt, current);
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
          turnstileEnabled: row.showTurnstile ? row.turnstileEnabled : false,
          notes: `Set to unlimited from Super Admin Plugins tab (${row.pluginLabel})`,
          ensurePluginWhenEnabled: false,
        },
        `Updated ${row.pluginLabel} limit for ${row.projectSlug}`,
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
        turnstileEnabled: row.showTurnstile ? row.turnstileEnabled : false,
        notes: `Updated monthly limit from Super Admin Plugins tab (${row.pluginLabel})`,
        ensurePluginWhenEnabled: false,
      },
      `Updated ${row.pluginLabel} limit for ${row.projectSlug}`,
    );
  };

  const updateTurnstile = async (row: ConsolidatedPluginRow, enabled: boolean) => {
    if (!row.showTurnstile) return;

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
      {queryErrors.length > 0 ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <div className="font-medium">Failed to load plugin access:</div>
          <ul className="mt-1 list-disc pl-5">
            {queryErrors.map((error) => (
              <li key={error.plugin}>
                {error.plugin}: {error.message}
              </li>
            ))}
          </ul>
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
                      <Badge>Deployed</Badge>
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
                    {project.pluginRows.map((pluginRow) => (
                      <div
                        key={pluginRow.pluginId}
                        className="rounded-md border bg-muted/15 p-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{pluginRow.pluginLabel}</div>
                            <div className="text-xs text-muted-foreground">
                              {pluginRow.pluginDescription}
                            </div>
                          </div>
                          <Badge variant={formatStateBadgeVariant(pluginRow.state)}>
                            {pluginRow.state}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {pluginRow.usageLabel}: {pluginRow.usageThisMonth} · Limit:{" "}
                          {pluginRow.monthlyEventLimit == null
                            ? "Unlimited"
                            : pluginRow.monthlyEventLimit}{" "}
                          · Scope: {pluginRow.effectiveScope} · Instance:{" "}
                          {pluginRow.projectPluginStatus || "-"} · Updated:{" "}
                          {formatDate(pluginRow.updatedAt)}
                        </div>
                        {pluginRow.showTurnstile ? (
                          <div className="mt-1 text-xs">
                            {pluginRow.turnstileEnabled ? (
                              pluginRow.state !== "enabled" ? (
                                <Badge variant="secondary">Turnstile On (inactive)</Badge>
                              ) : (
                                <Badge
                                  variant={
                                    pluginRow.turnstileReady ? "default" : "secondary"
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
                              pluginRow.state === "enabled" ? "default" : "outline"
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
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={upsertMutation.isPending}
                            onClick={() => void updateLimit(pluginRow)}
                          >
                            Limit
                          </Button>
                          {pluginRow.showTurnstile ? (
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
