import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2, Plug, RefreshCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { authClient } from "@/lib/auth-client";
import { LoadingSpinner } from "@/components/common";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@vivd/ui";

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

function getPluginStatusBadgeVariant(
  plugin: OrganizationPluginItem,
): "success" | "secondary" | "outline" {
  if (plugin.installState === "enabled") return "success";
  if (plugin.installState === "suspended") return "secondary";
  if (!plugin.instanceId) return "outline";
  return "secondary";
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

  return normalizedSearchTerms.every((term) => searchableContent.includes(term));
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
    () =>
      search
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    [search],
  );

  const filteredRows = useMemo(
    () => rows.filter((row) => includesAllSearchTerms(row, normalizedSearchTerms)),
    [normalizedSearchTerms, rows],
  );

  const isLoading = overviewQuery.isLoading && !overviewQuery.data;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Plugins
        </CardTitle>
        <CardDescription>
          Org-wide plugin overview with key statuses and issue signals. Use row actions
          to jump into project-level plugin configuration. Super admins can enable
          inactive plugins inline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Failed to load plugin overview: {overviewQuery.error.message}
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Plugins</th>
                <th className="px-3 py-2 font-medium">Issues</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.projectSlug} className="border-t align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.projectTitle || row.projectSlug}</div>
                    {row.projectTitle ? (
                      <div className="text-xs text-muted-foreground">{row.projectSlug}</div>
                    ) : null}
                    <div className="text-xs text-muted-foreground mt-1">
                      {row.deployedDomain
                        ? `Published: ${row.deployedDomain}`
                        : "Not published"}
                    </div>
                  </td>

                  <td className="px-3 py-2">
                    <div className="min-w-[320px] space-y-2">
                      {row.plugins.map((plugin) => (
                        <div key={plugin.pluginId} className="rounded-md border bg-muted/15 p-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-medium">{plugin.catalog.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {plugin.catalog.description}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <Badge variant={getPluginStatusBadgeVariant(plugin)}>
                                {getPluginStatusLabel(plugin)}
                              </Badge>
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
                                    ensureMutation.variables?.slug === row.projectSlug &&
                                    ensureMutation.variables?.pluginId === plugin.pluginId
                                  }
                                >
                                  {ensureMutation.isPending &&
                                  ensureMutation.variables?.slug === row.projectSlug &&
                                  ensureMutation.variables?.pluginId === plugin.pluginId ? (
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
                            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                              {plugin.summaryLines.map((line) => (
                                <div key={`${plugin.pluginId}:${line}`}>{line}</div>
                              ))}
                            </div>
                          ) : null}
                          {plugin.badges.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1">
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
                        </div>
                      ))}
                    </div>
                  </td>

                  <td className="px-3 py-2">
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
                                  ? "text-destructive"
                                  : "text-amber-500"
                              }`}
                            />
                            <span>{issue.message}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Badge variant="outline">No issues</Badge>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex min-w-[140px] flex-col gap-1">
                      <Button asChild size="sm" variant="outline">
                        <Link to={ROUTES.PROJECT_PLUGINS(row.projectSlug)}>
                          Open plugins
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link to={ROUTES.PROJECT(row.projectSlug)}>Open project</Link>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}

              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    {isLoading ? (
                      <LoadingSpinner message="Loading plugin overview..." />
                    ) : search.trim() ? (
                      "No projects match this search."
                    ) : (
                      "No projects found for this organization."
                    )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
