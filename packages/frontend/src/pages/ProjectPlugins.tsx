import { useEffect, useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
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
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { getProjectPluginUi } from "@/plugins/registry";

type ProjectPluginCatalogItem = RouterOutputs["plugins"]["catalog"]["plugins"][number];

function getPluginInstallBadgeVariant(
  state: ProjectPluginCatalogItem["installState"],
): "default" | "secondary" | "outline" {
  if (state === "enabled") return "default";
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
  installProfile: "solo" | "platform",
): string {
  if (plugin.installState === "enabled") {
    return "Open this plugin to view details, configuration, snippets, and plugin-specific actions.";
  }
  if (plugin.installState === "available") {
    return "This plugin is available for this project but has not been enabled yet.";
  }
  if (plugin.installState === "suspended") {
    return "This plugin is suspended for this project.";
  }
  return installProfile === "solo"
    ? "This plugin is disabled for this instance."
    : "This plugin is not currently available for this project.";
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
      className={isEmbedded ? "mx-auto w-full max-w-6xl px-4 py-4 sm:px-6" : undefined}
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
      <FormContent className={isEmbedded ? "mx-auto max-w-3xl" : "max-w-3xl"}>
        <div className="space-y-4">
          {catalogQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load plugin catalog: {catalogQuery.error.message}
            </div>
          ) : null}

          {(catalogQuery.data?.plugins ?? []).map((plugin) => {
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

            return (
              <Card key={plugin.pluginId}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{plugin.catalog.name}</CardTitle>
                      <CardDescription>{plugin.catalog.description}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {plugin.installState === "available" && canManageProjectPlugins ? (
                        <Button
                          size="sm"
                          variant="outline"
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
                      {plugin.installState === "enabled" ? (
                        <Button asChild size="sm" variant="outline">
                          <Link to={detailLink}>
                            {pluginUi?.openLabel ?? "Open plugin"}
                          </Link>
                        </Button>
                      ) : null}
                      <Badge variant={getPluginInstallBadgeVariant(plugin.installState)}>
                        {getPluginInstallBadgeLabel(plugin.installState)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {getPluginStatusCopy(plugin, config.installProfile)}
                  </p>
                  {plugin.instanceId ? (
                    <div className="text-xs text-muted-foreground">
                      Instance status: {plugin.instanceStatus ?? "unknown"}
                      {plugin.updatedAt
                        ? ` · Updated ${new Date(plugin.updatedAt).toLocaleString()}`
                        : ""}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </FormContent>
    </SettingsPageShell>
  );
}
