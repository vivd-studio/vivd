import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, Textarea } from "@vivd/ui";

import { trpc, type RouterOutputs } from "@/lib/trpc";
import {
  ProjectPluginAccessActions,
  ProjectPluginPageActions,
  useProjectPluginPageModel,
} from "./projectPageScaffold";

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
  const {
    utils,
    typedPluginId,
    pluginInfo,
    pluginInfoQuery: infoQuery,
    pluginPresentation,
    PluginIcon,
    canEnablePlugin: canManageProjectPlugins,
    canRequestPluginAccess,
    isRequestPending,
    requestAccessLabel,
    disabledCopy,
    ensureMutation,
    requestAccessMutation,
    refreshPluginPage,
  } = useProjectPluginPageModel({
    projectSlug,
    pluginId,
    isEmbedded,
    documentTitle: ({ projectTitle, pluginInfo, pluginPresentation }) =>
      `${projectTitle} ${pluginInfo?.catalog.name ?? pluginPresentation.title}`,
    enableToast: {
      success: "Plugin enabled for this project",
      error: "Failed to enable plugin",
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

  const badge = pluginInfo
    ? formatInstallBadge(pluginInfo.entitlementState, pluginInfo.enabled)
    : { label: "Loading", variant: "secondary" as const };
  const [configText, setConfigText] = useState("{}");

  useEffect(() => {
    if (!pluginInfo) return;
    setConfigText(prettyJson(pluginInfo.config ?? pluginInfo.defaultConfig ?? {}));
  }, [pluginInfo]);
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
        <ProjectPluginPageActions
          projectSlug={projectSlug}
          isEmbedded={isEmbedded}
          onRefresh={() => {
            void refreshPluginPage();
          }}
          isRefreshing={infoQuery.isFetching}
        />
      }
    >
      <div className={isEmbedded ? "mx-auto max-w-3xl space-y-4" : "max-w-3xl space-y-4"}>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
                    <PluginIcon className="h-4 w-4" />
                  </span>
                  <span>{pluginInfo?.catalog.name ?? pluginPresentation.title}</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {pluginInfo?.catalog.description ?? "Plugin details"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!pluginInfo?.enabled ? (
                  <ProjectPluginAccessActions
                    canEnablePlugin={canManageProjectPlugins}
                    canRequestPluginAccess={canRequestPluginAccess}
                    isEnablePending={ensureMutation.isPending}
                    isRequestPending={isRequestPending}
                    isRequestSubmitting={requestAccessMutation.isPending}
                    requestAccessLabel={requestAccessLabel}
                    onEnable={() =>
                      ensureMutation.mutate({
                        slug: projectSlug,
                        pluginId: typedPluginId,
                      })
                    }
                    onRequestAccess={() =>
                      requestAccessMutation.mutate({
                        slug: projectSlug,
                        pluginId: typedPluginId,
                      })
                    }
                  />
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
