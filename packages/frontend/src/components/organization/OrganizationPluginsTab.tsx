import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Plug, RefreshCcw, Search } from "lucide-react";
import { ROUTES } from "@/app/router";
import { LoadingSpinner } from "@/components/common";
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
import { trpc, type RouterOutputs } from "@/lib/trpc";

type OrganizationPluginsOverviewRow =
  RouterOutputs["organization"]["pluginsOverview"]["rows"][number];

function getPluginStatusLabel(status: "enabled" | "disabled" | "not_installed"): string {
  if (status === "enabled") return "Enabled";
  if (status === "disabled") return "Disabled";
  return "Not installed";
}

function getPluginStatusBadgeVariant(
  status: "enabled" | "disabled" | "not_installed",
): "success" | "secondary" | "outline" {
  if (status === "enabled") return "success";
  if (status === "disabled") return "secondary";
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
    ...row.issues.map((issue) => issue.message),
  ]
    .join(" ")
    .toLowerCase();

  return normalizedSearchTerms.every((term) => searchableContent.includes(term));
}

export function OrganizationPluginsTab() {
  const [search, setSearch] = useState("");
  const overviewQuery = trpc.organization.pluginsOverview.useQuery();
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
          to jump into project-level plugin configuration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search projects or issues"
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
                <th className="px-3 py-2 font-medium">Contact Form</th>
                <th className="px-3 py-2 font-medium">Analytics</th>
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
                    <Badge variant={getPluginStatusBadgeVariant(row.contactForm.status)}>
                      {getPluginStatusLabel(row.contactForm.status)}
                    </Badge>
                    {row.contactForm.status === "enabled" ? (
                      <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                        <div>
                          Recipients configured: {row.contactForm.configuredRecipientCount}
                        </div>
                        {row.contactForm.pendingRecipientCount > 0 ? (
                          <div>
                            Pending verification: {row.contactForm.pendingRecipientCount}
                          </div>
                        ) : null}
                        {row.contactForm.turnstileEnabled ? (
                          <Badge
                            variant={
                              row.contactForm.turnstileReady ? "success" : "destructive"
                            }
                            className="mt-1"
                          >
                            {row.contactForm.turnstileReady
                              ? "Turnstile ready"
                              : "Turnstile syncing"}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </td>

                  <td className="px-3 py-2">
                    <Badge variant={getPluginStatusBadgeVariant(row.analytics.status)}>
                      {getPluginStatusLabel(row.analytics.status)}
                    </Badge>
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
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
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
