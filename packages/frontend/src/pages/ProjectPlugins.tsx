import { useEffect, useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { SettingsPageShell, FormContent } from "@/components/settings/SettingsPageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppConfig } from "@/lib/AppConfigContext";
import { authClient } from "@/lib/auth-client";
import { formatDocumentTitle } from "@/lib/brand";
import { isExperimentalSoloInstall } from "@/lib/featureFlags";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { getProjectPluginUi } from "@/plugins/registry";

type ProjectPluginCatalogItem = RouterOutputs["plugins"]["catalog"]["plugins"][number];

function getPluginInstallBadgeVariant(
  state: ProjectPluginCatalogItem["installState"],
): "success" | "secondary" | "outline" {
  if (state === "enabled") return "success";
  if (state === "available") return "outline";
  return "secondary";
}

function getPluginInstallBadgeLabel(
  state: ProjectPluginCatalogItem["installState"],
): string {
  if (state === "enabled") return "Enabled";
  if (state === "available") return "Available";
  if (state === "suspended") return "Suspended";
  return "Disabled";
}

function getPluginStatusCopy(
  plugin: ProjectPluginCatalogItem,
  isExperimentalSolo: boolean,
): string {
  if (plugin.installState === "enabled") {
    return "Configured for this project and ready to open.";
  }
  if (plugin.installState === "available") {
    return "Available in this instance and ready to enable for this project.";
  }
  if (plugin.installState === "suspended") {
    return "Suspended for this project.";
  }
  return isExperimentalSolo
    ? "Unavailable in this experimental self-host compatibility install."
    : "Not currently available for this project.";
}

function formatPluginTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getPluginCardLinkLabel(
  plugin: ProjectPluginCatalogItem,
  openLabel?: string,
): string {
  if (plugin.installState === "enabled") {
    return openLabel ?? "Open plugin";
  }
  return "View details";
}

function formatPluginCount(count: number): string {
  return count === 1 ? "1 plugin" : `${count} plugins`;
}

export default function ProjectPlugins() {
  const { config } = useAppConfig();
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const utils = trpc.useUtils();
  const { data: session } = authClient.useSession();
  const isEmbedded = useMemo(
    () => new URLSearchParams(location.search).get("embedded") === "1",
    [location.search],
  );

  const slug = projectSlug || "";
  const catalogQuery = trpc.plugins.catalog.useQuery(
    { slug },
    { enabled: !!projectSlug },
  );
  const projectListQuery = trpc.project.list.useQuery(undefined, {
    enabled: !!projectSlug,
  });
  const genericEnsureMutation = trpc.plugins.ensure.useMutation({
    onSuccess: async () => {
      toast.success("Plugin enabled for this project");
      await utils.plugins.catalog.invalidate({ slug });
    },
    onError: (error) => {
      toast.error("Failed to enable plugin", {
        description: error.message,
      });
    },
  });

  const projectTitle =
    projectListQuery.data?.projects?.find((project) => project.slug === slug)?.title ?? slug;
  const canManageProjectPlugins = session?.user?.role === "super_admin";
  const isExperimentalSolo = isExperimentalSoloInstall(config);
  const plugins = catalogQuery.data?.plugins ?? [];
  const enabledCount = plugins.filter((plugin) => plugin.installState === "enabled").length;
  const availableCount = plugins.filter((plugin) => plugin.installState === "available").length;
  const attentionCount = plugins.filter(
    (plugin) =>
      plugin.installState === "disabled" || plugin.installState === "suspended",
  ).length;
  const latestPluginUpdate = useMemo(() => {
    let latest: number | null = null;
    for (const plugin of plugins) {
      if (!plugin.updatedAt) continue;
      const parsed = new Date(plugin.updatedAt).getTime();
      if (Number.isNaN(parsed)) continue;
      if (latest === null || parsed > latest) latest = parsed;
    }
    return latest ? new Date(latest).toISOString() : null;
  }, [plugins]);
  const pluginSections = useMemo(
    () =>
      [
        {
          key: "enabled",
          title: "Enabled",
          description: "Ready to open for this project.",
          plugins: plugins.filter((plugin) => plugin.installState === "enabled"),
        },
        {
          key: "available",
          title: "Ready to enable",
          description: canManageProjectPlugins
            ? "Available in this instance and waiting for project activation."
            : "Available in this instance. A super-admin can enable them for this project.",
          plugins: plugins.filter((plugin) => plugin.installState === "available"),
        },
        {
          key: "attention",
          title: "Needs attention",
          description: isExperimentalSolo
            ? "Currently limited by project or instance policy in experimental solo mode."
            : "Suspended or unavailable plugins that may need follow-up.",
          plugins: plugins.filter(
            (plugin) =>
              plugin.installState === "disabled" || plugin.installState === "suspended",
          ),
        },
      ].filter((section) => section.plugins.length > 0),
    [canManageProjectPlugins, isExperimentalSolo, plugins],
  );

  useEffect(() => {
    if (!projectSlug) return;
    document.title = formatDocumentTitle(`${projectTitle} Plugins`);
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [projectSlug, projectTitle]);

  if (!projectSlug) {
    return <div className="text-sm text-muted-foreground">Missing project slug.</div>;
  }

  return (
    <SettingsPageShell
      title="Plugins"
      description={`Configure runtime plugins for ${projectSlug}.`}
      className={
        isEmbedded
          ? "w-full max-w-4xl px-4 py-4 sm:px-6"
          : "w-full max-w-4xl"
      }
      actions={
        <div className="flex items-center gap-2">
          {!isEmbedded ? (
            <Button variant="outline" asChild>
              <Link to={ROUTES.PROJECT(projectSlug)}>Back to project</Link>
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([catalogQuery.refetch(), projectListQuery.refetch()]);
            }}
            disabled={catalogQuery.isLoading}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>
      }
    >
      <FormContent className="max-w-none">
        <div className="space-y-6">
          {catalogQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load plugin catalog: {catalogQuery.error.message}
            </div>
          ) : null}

          <Card className="shadow-none">
            <CardHeader className="pb-4">
              <CardTitle>Overview</CardTitle>
              <CardDescription>
                Plugins are managed per project. Open any row to review
                configuration, snippets, and plugin-specific activity.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border px-4 py-3">
                <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {[
                    { label: "Enabled", value: enabledCount },
                    { label: "Ready to enable", value: availableCount },
                    { label: "Needs attention", value: attentionCount },
                  ].map((stat) => (
                    <div key={stat.label} className="flex items-baseline gap-2">
                      <dt className="text-muted-foreground">{stat.label}</dt>
                      <dd className="font-medium text-foreground">{stat.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <dl className="grid gap-4 rounded-lg border px-4 py-4 text-sm sm:grid-cols-3">
                {[
                  { label: "Project", value: projectTitle },
                  {
                    label: "Latest change",
                    value: latestPluginUpdate
                      ? formatPluginTimestamp(latestPluginUpdate)
                      : "No runtime plugin changes recorded yet.",
                  },
                  {
                    label: "Scope",
                    value: isExperimentalSolo
                      ? "Experimental self-host compatibility may limit plugin availability."
                      : "Plugin activation is scoped to this project.",
                  },
                ].map((item) => (
                  <div key={item.label} className="space-y-1">
                    <dt className="text-xs text-muted-foreground">{item.label}</dt>
                    <dd className="font-medium text-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          {plugins.length === 0 ? (
            <Card className="border-dashed border-border/60 bg-card/45 shadow-none">
              <CardContent className="p-8 text-sm text-muted-foreground">
                No runtime plugins are available for this project yet.
              </CardContent>
            </Card>
          ) : null}

          {pluginSections.map((section) => (
            <section
              key={section.key}
              aria-labelledby={`${section.key}-plugins-heading`}
              className="space-y-3"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                  <h2 id={`${section.key}-plugins-heading`} className="text-base font-semibold">
                    {section.title}
                  </h2>
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatPluginCount(section.plugins.length)}
                </div>
              </div>

              <div className="space-y-3">
                {section.plugins.map((plugin) => {
                  const pluginUi = getProjectPluginUi(plugin.pluginId);
                  const routePath = ROUTES.PROJECT_PLUGIN(
                    projectSlug,
                    plugin.pluginId,
                    pluginUi?.defaultSubpath,
                  );
                  const detailLink = isEmbedded ? `${routePath}?embedded=1` : routePath;
                  const isEnablePending =
                    genericEnsureMutation.isPending &&
                    genericEnsureMutation.variables?.pluginId === plugin.pluginId;
                  const formattedUpdatedAt = formatPluginTimestamp(plugin.updatedAt);

                  return (
                    <Card
                      key={plugin.pluginId}
                      className="relative overflow-hidden border-border/80 shadow-none transition-colors hover:bg-accent/20"
                    >
                      <Link
                        to={detailLink}
                        aria-label={`${plugin.catalog.name} details`}
                        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      />
                      <CardContent className="pointer-events-none relative z-10 grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                        <div className="min-w-0 space-y-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-medium">{plugin.catalog.name}</div>
                              <Badge
                                variant={getPluginInstallBadgeVariant(plugin.installState)}
                                className="shrink-0"
                              >
                                {getPluginInstallBadgeLabel(plugin.installState)}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {plugin.catalog.description}
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {getPluginStatusCopy(plugin, isExperimentalSolo)}
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {plugin.instanceId ? (
                              <span>Instance {plugin.instanceStatus ?? "unknown"}</span>
                            ) : null}
                            {formattedUpdatedAt ? (
                              <span>Updated {formattedUpdatedAt}</span>
                            ) : null}
                            {!plugin.instanceId && !formattedUpdatedAt ? (
                              <span>No project instance attached yet</span>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:justify-start">
                          {plugin.installState === "available" && canManageProjectPlugins ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="pointer-events-auto w-full sm:w-auto"
                              onClick={() =>
                                genericEnsureMutation.mutate({
                                  slug,
                                  pluginId: plugin.pluginId,
                                })
                              }
                              disabled={isEnablePending}
                            >
                              {isEnablePending ? (
                                <>
                                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                  Enabling...
                                </>
                              ) : (
                                "Enable for this project"
                              )}
                            </Button>
                          ) : null}

                          <div className="hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
                            <span>{getPluginCardLinkLabel(plugin, pluginUi?.openLabel)}</span>
                            <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </FormContent>
    </SettingsPageShell>
  );
}
