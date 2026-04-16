import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppConfig } from "@/lib/AppConfigContext";
import { authClient } from "@/lib/auth-client";
import { formatDocumentTitle } from "@/lib/brand";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type GenericProjectPluginPageProps = {
  projectSlug: string;
  pluginId: string;
  isEmbedded?: boolean;
};

function formatInstallBadge(
  state: RouterOutputs["plugins"]["info"]["entitlementState"],
  enabled: boolean,
): {
  label: string;
  variant: "default" | "secondary" | "outline";
} {
  if (enabled) {
    return { label: "Enabled", variant: "default" };
  }
  if (state === "enabled") {
    return { label: "Available", variant: "outline" };
  }
  if (state === "suspended") {
    return { label: "Suspended", variant: "secondary" };
  }
  return { label: "Disabled", variant: "secondary" };
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export default function GenericProjectPluginPage({
  projectSlug,
  pluginId,
  isEmbedded = false,
}: GenericProjectPluginPageProps) {
  const { config } = useAppConfig();
  const utils = trpc.useUtils();
  const { data: session } = authClient.useSession();
  const canManageProjectPlugins = session?.user?.role === "super_admin";
  const typedPluginId = pluginId as RouterOutputs["plugins"]["catalog"]["plugins"][number]["pluginId"];

  const infoQuery = trpc.plugins.info.useQuery(
    { slug: projectSlug, pluginId: typedPluginId },
    { enabled: Boolean(projectSlug && pluginId) },
  );
  const projectListQuery = trpc.project.list.useQuery(undefined, {
    enabled: !!projectSlug,
  });
  const ensureMutation = trpc.plugins.ensure.useMutation({
    onSuccess: async () => {
      toast.success("Plugin enabled for this project");
      await Promise.all([
        utils.plugins.catalog.invalidate({ slug: projectSlug }),
        utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId }),
      ]);
    },
    onError: (error) => {
      toast.error("Failed to enable plugin", { description: error.message });
    },
  });
  const updateConfigMutation = trpc.plugins.updateConfig.useMutation({
    onSuccess: async () => {
      toast.success("Plugin configuration saved");
      await utils.plugins.info.invalidate({ slug: projectSlug, pluginId: typedPluginId });
    },
    onError: (error) => {
      toast.error("Failed to save plugin configuration", {
        description: error.message,
      });
    },
  });

  const pluginInfo = infoQuery.data;
  const projectTitle =
    projectListQuery.data?.projects?.find((project) => project.slug === projectSlug)?.title ??
    projectSlug;
  const badge = pluginInfo
    ? formatInstallBadge(pluginInfo.entitlementState, pluginInfo.enabled)
    : { label: "Loading", variant: "secondary" as const };
  const [configText, setConfigText] = useState("{}");

  useEffect(() => {
    if (!pluginInfo) return;
    setConfigText(prettyJson(pluginInfo.config ?? pluginInfo.defaultConfig ?? {}));
  }, [pluginInfo]);

  useEffect(() => {
    if (!projectSlug) return;
    const name = pluginInfo?.catalog.name ?? pluginId;
    document.title = formatDocumentTitle(`${projectTitle} ${name}`);
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [pluginId, pluginInfo?.catalog.name, projectSlug, projectTitle]);

  const disabledCopy = useMemo(() => {
    if (!pluginInfo) return "Loading plugin info...";
    if (pluginInfo.entitlementState === "enabled" && !pluginInfo.enabled) {
      return canManageProjectPlugins
        ? `${pluginInfo.catalog.name} is available for this instance but has not been enabled for this project yet.`
        : `${pluginInfo.catalog.name} is available for this instance, but a super-admin still needs to enable it for this project.`;
    }
    if (pluginInfo.entitlementState === "suspended") {
      return `${pluginInfo.catalog.name} is suspended for this project.`;
    }
    return config.installProfile === "solo" && config.experimentalSoloModeEnabled
      ? `${pluginInfo.catalog.name} is disabled for this experimental self-host installation. Open Instance Settings -> Plugins to enable it.`
      : `${pluginInfo.catalog.name} access is managed in Super Admin. Ask a super-admin to enable it for this project.`;
  }, [
    canManageProjectPlugins,
    config.experimentalSoloModeEnabled,
    config.installProfile,
    pluginInfo,
  ]);

  const handleSaveConfig = () => {
    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(configText) as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Configuration must be valid JSON", { description: message });
      return;
    }

    updateConfigMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      config: parsedConfig,
    });
  };

  const snippets = pluginInfo?.snippets && typeof pluginInfo.snippets === "object"
    ? Object.entries(pluginInfo.snippets)
    : [];

  return (
    <SettingsPageShell
      title={pluginInfo?.catalog.name ?? pluginId}
      description={
        pluginInfo?.catalog.description ??
        `Configure the ${pluginId} plugin for ${projectSlug}.`
      }
      className={isEmbedded ? "mx-auto w-full max-w-6xl px-4 py-4 sm:px-6" : undefined}
      actions={
        <div className="flex items-center gap-2">
          {!isEmbedded ? (
            <Button variant="outline" asChild>
              <Link to={ROUTES.PROJECT_PLUGINS(projectSlug)}>Back to plugins</Link>
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([
                projectListQuery.refetch(),
                infoQuery.refetch(),
              ]);
            }}
            disabled={infoQuery.isLoading}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>
      }
    >
      <div className={isEmbedded ? "mx-auto max-w-3xl space-y-4" : "max-w-3xl space-y-4"}>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{pluginInfo?.catalog.name ?? pluginId}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {pluginInfo?.catalog.description ?? "Plugin details"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!pluginInfo?.enabled &&
                pluginInfo?.entitlementState === "enabled" &&
                canManageProjectPlugins ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      ensureMutation.mutate({
                        slug: projectSlug,
                        pluginId: typedPluginId,
                      })
                    }
                    disabled={ensureMutation.isPending}
                  >
                    {ensureMutation.isPending ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        Enabling...
                      </>
                    ) : (
                      "Enable for this project"
                    )}
                  </Button>
                ) : null}
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {infoQuery.error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Failed to load plugin info: {infoQuery.error.message}
              </div>
            ) : null}
            {!pluginInfo?.enabled ? (
              <p className="text-sm text-muted-foreground">{disabledCopy}</p>
            ) : (
              <>
                {pluginInfo.instructions.length > 0 ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Instructions</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {pluginInfo.instructions.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {pluginInfo.usage ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Usage</h3>
                    <pre className="overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
                      {prettyJson(pluginInfo.usage)}
                    </pre>
                  </div>
                ) : null}

                {snippets.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Snippets</h3>
                    {snippets.map(([key, value]) => (
                      <div key={key} className="space-y-1">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          {key}
                        </Label>
                        <pre className="overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
                          {typeof value === "string" ? value : prettyJson(value)}
                        </pre>
                      </div>
                    ))}
                  </div>
                ) : null}

                {pluginInfo.capabilities.config?.supportsApply ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium">Configuration</h3>
                      <p className="text-xs text-muted-foreground">
                        Edit the plugin config as JSON.
                      </p>
                    </div>
                    <Textarea
                      value={configText}
                      onChange={(event) => setConfigText(event.target.value)}
                      rows={16}
                      className="font-mono text-xs"
                    />
                    <div className="flex justify-end">
                      <Button
                        onClick={handleSaveConfig}
                        disabled={updateConfigMutation.isPending}
                      >
                        {updateConfigMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Save configuration"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </SettingsPageShell>
  );
}
