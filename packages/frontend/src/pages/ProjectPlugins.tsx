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
import {
  getPluginAccessRequestLabel,
  getProjectPluginPresentation,
  isPluginAccessRequestPending,
} from "@/plugins/presentation";

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
  canManageProjectPlugins: boolean,
): string {
  if (plugin.installState === "enabled") {
    return "Configured for this project and ready to open.";
  }
  if (plugin.installState === "available") {
    return "Available in this instance and ready to enable for this project.";
  }
  if (plugin.installState === "suspended") {
    return canManageProjectPlugins
      ? "Suspended for this project. You can enable it again here."
      : "Suspended for this project.";
  }
  if (canManageProjectPlugins) {
    return isExperimentalSolo
      ? "Not active in this experimental self-host compatibility install. You can enable it here for this project."
      : "Not active for this project. You can enable it here.";
  }
  return isExperimentalSolo
    ? "Not active in this experimental self-host compatibility install."
    : "Not active for this project.";
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
  const { data: session, isPending: isSessionPending } = authClient.useSession();
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
      await Promise.all([
        utils.plugins.catalog.invalidate({ slug }),
        utils.project.list.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error("Failed to enable plugin", {
        description: error.message,
      });
    },
  });
  const requestAccessMutation = trpc.plugins.requestAccess.useMutation({
    onSuccess: async () => {
      toast.success("Access request sent");
      await utils.plugins.catalog.invalidate({ slug });
    },
    onError: (error) => {
      toast.error("Failed to send access request", {
        description: error.message,
      });
    },
  });

  const projectTitle =
    projectListQuery.data?.projects?.find((project) => project.slug === slug)?.title ?? slug;
  const canManageProjectPlugins = session?.user?.role === "super_admin";
  const canRequestPluginAccess =
    !isSessionPending && !canManageProjectPlugins && Boolean(config.supportEmail);
  const isExperimentalSolo = isExperimentalSoloInstall(config);
  const plugins = catalogQuery.data?.plugins ?? [];
  const enabledCount = plugins.filter((plugin) => plugin.installState === "enabled").length;
  const availableCount = plugins.filter((plugin) => plugin.installState === "available").length;
  const attentionCount = plugins.filter(
    (plugin) =>
      plugin.installState === "disabled" || plugin.installState === "suspended",
  ).length;
  const enabledPluginEntries = useMemo(
    () =>
      plugins
        .filter((plugin) => plugin.installState === "enabled")
        .map((plugin) => getProjectPluginPresentation(plugin.pluginId, projectSlug)),
    [plugins, projectSlug],
  );
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
          description: isSessionPending
            ? "Available in this instance and waiting for project activation."
            : canManageProjectPlugins
              ? "Available in this instance and waiting for project activation."
              : "Available in this instance. A super-admin can enable them for this project.",
          plugins: plugins.filter((plugin) => plugin.installState === "available"),
        },
        {
          key: "attention",
          title: "Not active",
          description: isExperimentalSolo
            ? "Currently disabled or suspended by project or instance policy in experimental solo mode."
            : "Disabled or suspended plugins for this project.",
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
                    { label: "Not active", value: attentionCount },
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
              {enabledPluginEntries.length > 0 ? (
                <div className="rounded-lg border px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">Enabled plugins</span>
                    {enabledPluginEntries.map((plugin) => {
                      const PluginIcon = plugin.icon;
                      return (
                        <Button key={plugin.pluginId} variant="outline" size="sm" asChild>
                          <Link to={plugin.path ?? ROUTES.PROJECT_PLUGIN(projectSlug, plugin.pluginId)}>
                            <PluginIcon className="mr-1.5 h-4 w-4" />
                            {plugin.title}
                          </Link>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
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
                  const pluginPresentation = getProjectPluginPresentation(
                    plugin.pluginId,
                    projectSlug,
                  );
                  const routePath =
                    pluginPresentation.path ??
                    ROUTES.PROJECT_PLUGIN(projectSlug, plugin.pluginId);
                  const detailLink = isEmbedded ? `${routePath}?embedded=1` : routePath;
                  const isEnablePending =
                    genericEnsureMutation.isPending &&
                    genericEnsureMutation.variables?.pluginId === plugin.pluginId;
                  const isRequestPending = isPluginAccessRequestPending(plugin.accessRequest);
                  const isRequestSending =
                    requestAccessMutation.isPending &&
                    requestAccessMutation.variables?.pluginId === plugin.pluginId;
                  const formattedUpdatedAt = formatPluginTimestamp(plugin.updatedAt);
                  const PluginIcon = pluginPresentation.icon;

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
                              <div className="flex items-center gap-2 font-medium">
                                <span className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
                                  <PluginIcon className="h-4 w-4" />
                                </span>
                                <span>{plugin.catalog.name}</span>
                              </div>
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
                            {getPluginStatusCopy(
                              plugin,
                              isExperimentalSolo,
                              canManageProjectPlugins,
                            )}
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
                          {plugin.installState !== "enabled" && canManageProjectPlugins ? (
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
                          {plugin.installState !== "enabled" && canRequestPluginAccess ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="pointer-events-auto w-full sm:w-auto"
                              onClick={() =>
                                requestAccessMutation.mutate({
                                  slug,
                                  pluginId: plugin.pluginId,
                                })
                              }
                              disabled={isRequestPending || isRequestSending}
                            >
                              {isRequestSending ? (
                                <>
                                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                  Sending...
                                </>
                              ) : (
                                getPluginAccessRequestLabel(plugin.accessRequest)
                              )}
                            </Button>
                          ) : null}

                          <div className="hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
                            <span>{getPluginCardLinkLabel(plugin, pluginPresentation.openLabel)}</span>
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
