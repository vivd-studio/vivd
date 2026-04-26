import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2, Plug, RefreshCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { authClient } from "@/lib/auth-client";
import { LoadingSpinner } from "@/components/common";
import {
  Badge,
  Button,
  Callout,
  CalloutDescription,
  CalloutTitle,
  Input,
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@vivd/ui";

import { trpc, type RouterOutputs } from "@/lib/trpc";

type OrganizationPluginsOverviewRow =
  RouterOutputs["organization"]["pluginsOverview"]["rows"][number];
type OrganizationPluginItem = OrganizationPluginsOverviewRow["plugins"][number];

function getPluginStatusLabel(plugin: OrganizationPluginItem): string {
  if (plugin.installState === "enabled") return "Enabled";
  if (plugin.installState === "suspended") return "Suspended";
  if (!plugin.instanceId) return "Not installed";
  return "Disabled";
}

function getPluginStatusTone(
  plugin: OrganizationPluginItem,
): "success" | "warn" | "neutral" {
  if (plugin.installState === "enabled") return "success";
  if (plugin.installState === "suspended") return "warn";
  return "neutral";
}

function getBadgeVariant(
  tone: OrganizationPluginItem["badges"][number]["tone"],
): "success" | "secondary" | "outline" | "destructive" {
  if (tone === "success") return "success";
  if (tone === "destructive") return "destructive";
  if (tone === "secondary") return "secondary";
  return "outline";
}

function includesAllSearchTerms(
  row: OrganizationPluginsOverviewRow,
  normalizedSearchTerms: string[],
): boolean {
  if (normalizedSearchTerms.length === 0) return true;

  const searchableContent = [
    row.projectSlug,
    row.projectTitle,
    row.deployedDomain ?? "",
    ...row.plugins.flatMap((plugin) => [
      plugin.catalog.name,
      plugin.catalog.description,
      ...plugin.summaryLines,
      ...plugin.badges.map((badge) => badge.label),
    ]),
    ...row.issues.map((issue) => issue.message),
  ]
    .join(" ")
    .toLowerCase();

  return normalizedSearchTerms.every((term) =>
    searchableContent.includes(term),
  );
}

export function OrganizationPluginsTab() {
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();
  const overviewQuery = trpc.organization.pluginsOverview.useQuery();
  const { data: session } = authClient.useSession();
  const canManageProjectPlugins = session?.user?.role === "super_admin";
  const ensureMutation = trpc.plugins.ensure.useMutation({
    onSuccess: async () => {
      toast.success("Plugin enabled for this project");
      await Promise.all([
        utils.organization.pluginsOverview.invalidate(),
        utils.project.list.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error("Failed to enable plugin", {
        description: error.message,
      });
    },
  });
  const rows = overviewQuery.data?.rows ?? [];

  const normalizedSearchTerms = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => includesAllSearchTerms(row, normalizedSearchTerms)),
    [normalizedSearchTerms, rows],
  );

  const isLoading = overviewQuery.isLoading && !overviewQuery.data;

  return (
    <Panel>
      <PanelHeader className="space-y-3">
        <PanelTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Plugins
        </PanelTitle>
        <PanelDescription>
          Org-wide plugin overview with key statuses and issue signals. Use row
          actions to jump into project-level plugin configuration. Super admins
          can enable inactive plugins inline.
        </PanelDescription>
      </PanelHeader>
      <PanelContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search projects, plugins, or issues"
              className="pl-8"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void overviewQuery.refetch()}
            disabled={overviewQuery.isFetching}
          >
            <RefreshCcw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {overviewQuery.error ? (
          <Callout tone="danger" icon={<AlertTriangle />}>
            <CalloutTitle>Failed to load plugin overview</CalloutTitle>
            <CalloutDescription>
              {overviewQuery.error.message}
            </CalloutDescription>
          </Callout>
        ) : null}

        <Panel tone="sunken" className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Plugins</TableHead>
                  <TableHead>Issues</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.projectSlug}>
                    <TableCell>
                      <div className="font-medium">
                        {row.projectTitle || row.projectSlug}
                      </div>
                      {row.projectTitle ? (
                        <div className="text-xs text-muted-foreground">
                          {row.projectSlug}
                        </div>
                      ) : null}
                      <div className="text-xs text-muted-foreground mt-1">
                        {row.deployedDomain
                          ? `Published: ${row.deployedDomain}`
                          : "Not published"}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="min-w-[320px] space-y-2">
                        {row.plugins.map((plugin) => (
                          <Panel key={plugin.pluginId} className="p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="font-medium">
                                  {plugin.catalog.name}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {plugin.catalog.description}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <StatusPill tone={getPluginStatusTone(plugin)}>
                                  {getPluginStatusLabel(plugin)}
                                </StatusPill>
                                {canManageProjectPlugins &&
                                plugin.installState !== "enabled" ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      ensureMutation.mutate({
                                        slug: row.projectSlug,
                                        pluginId: plugin.pluginId,
                                      })
                                    }
                                    disabled={
                                      ensureMutation.isPending &&
                                      ensureMutation.variables?.slug ===
                                        row.projectSlug &&
                                      ensureMutation.variables?.pluginId ===
                                        plugin.pluginId
                                    }
                                  >
                                    {ensureMutation.isPending &&
                                    ensureMutation.variables?.slug ===
                                      row.projectSlug &&
                                    ensureMutation.variables?.pluginId ===
                                      plugin.pluginId ? (
                                      <>
                                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                        Enabling...
                                      </>
                                    ) : (
                                      "Enable"
                                    )}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            {plugin.summaryLines.length > 0 ? (
                              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                {plugin.summaryLines.map((line) => (
                                  <div key={`${plugin.pluginId}:${line}`}>
                                    {line}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {plugin.badges.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-1">
                                {plugin.badges.map((badge) => (
                                  <Badge
                                    key={`${plugin.pluginId}:${badge.label}`}
                                    variant={getBadgeVariant(badge.tone)}
                                  >
                                    {badge.label}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </Panel>
                        ))}
                      </div>
                    </TableCell>

                    <TableCell>
                      {row.issues.length > 0 ? (
                        <div className="space-y-1">
                          {row.issues.map((issue) => (
                            <div
                              key={`${row.projectSlug}:${issue.code}`}
                              className="flex items-start gap-1.5 text-xs text-muted-foreground"
                            >
                              <AlertTriangle
                                className={`h-3.5 w-3.5 mt-0.5 ${
                                  issue.severity === "warning"
                                    ? "text-amber-500 dark:text-amber-400"
                                    : "text-destructive"
                                }`}
                              />
                              <span>{issue.message}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <StatusPill tone="neutral">No issues</StatusPill>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="flex min-w-[140px] flex-col gap-1">
                        <Button asChild size="sm" variant="outline">
                          <Link to={ROUTES.PROJECT_PLUGINS(row.projectSlug)}>
                            Open plugins
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={ROUTES.PROJECT(row.projectSlug)}>
                            Open project
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {isLoading ? (
                        <LoadingSpinner message="Loading plugin overview..." />
                      ) : search.trim() ? (
                        "No projects match this search."
                      ) : (
                        "No projects found for this organization."
                      )}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Panel>
      </PanelContent>
    </Panel>
  );
}
