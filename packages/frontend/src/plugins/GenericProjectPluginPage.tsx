import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
import {
  Button,
  Callout,
  CalloutDescription,
  CalloutTitle,
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatusPill,
  Textarea,
} from "@vivd/ui";

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
  tone: "success" | "warn" | "neutral";
} {
  if (enabled) {
    return { label: "Enabled", tone: "success" };
  }
  if (state === "enabled") {
    return { label: "Available", tone: "neutral" };
  }
  if (state === "suspended") {
    return { label: "Suspended", tone: "warn" };
  }
  return { label: "Disabled", tone: "neutral" };
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
      await utils.plugins.info.invalidate({
        slug: projectSlug,
        pluginId: typedPluginId,
      });
    },
    onError: (error) => {
      toast.error("Failed to save plugin configuration", {
        description: error.message,
      });
    },
  });

  const badge = pluginInfo
    ? formatInstallBadge(pluginInfo.entitlementState, pluginInfo.enabled)
    : { label: "Loading", tone: "neutral" as const };
  const [configText, setConfigText] = useState("{}");

  useEffect(() => {
    if (!pluginInfo) return;
    setConfigText(
      prettyJson(pluginInfo.config ?? pluginInfo.defaultConfig ?? {}),
    );
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

  const snippets =
    pluginInfo?.snippets && typeof pluginInfo.snippets === "object"
      ? Object.entries(pluginInfo.snippets)
      : [];

  return (
    <SettingsPageShell
      title={pluginInfo?.catalog.name ?? pluginId}
      description={
        pluginInfo?.catalog.description ??
        `Configure the ${pluginId} plugin for ${projectSlug}.`
      }
      className={
        isEmbedded ? "mx-auto w-full max-w-6xl px-4 py-4 sm:px-6" : undefined
      }
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
      <div
        className={
          isEmbedded ? "mx-auto max-w-3xl space-y-4" : "max-w-3xl space-y-4"
        }
      >
        <Panel>
          <PanelHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <PanelTitle className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border bg-surface-sunken text-muted-foreground">
                    <PluginIcon className="h-4 w-4" />
                  </span>
                  <span>
                    {pluginInfo?.catalog.name ?? pluginPresentation.title}
                  </span>
                </PanelTitle>
                <PanelDescription>
                  {pluginInfo?.catalog.description ?? "Plugin details"}
                </PanelDescription>
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
                <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
              </div>
            </div>
          </PanelHeader>
          <PanelContent className="space-y-4">
            {infoQuery.error ? (
              <Callout tone="danger">
                <CalloutTitle>Failed to load plugin info</CalloutTitle>
                <CalloutDescription>
                  {infoQuery.error.message}
                </CalloutDescription>
              </Callout>
            ) : null}
            {!pluginInfo?.enabled ? (
              <Callout tone="warn">
                <CalloutDescription>{disabledCopy}</CalloutDescription>
              </Callout>
            ) : (
              <>
                {pluginInfo.instructions.length > 0 ? (
                  <Panel tone="sunken" className="p-4">
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium">Instructions</h3>
                      <ul className="space-y-1 text-sm text-muted-foreground">
                        {pluginInfo.instructions.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  </Panel>
                ) : null}

                {pluginInfo.usage ? (
                  <Panel tone="sunken" className="p-4">
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium">Usage</h3>
                      <Panel tone="sunken" className="overflow-auto p-3">
                        <pre className="text-xs whitespace-pre-wrap break-words">
                          {prettyJson(pluginInfo.usage)}
                        </pre>
                      </Panel>
                    </div>
                  </Panel>
                ) : null}

                {snippets.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Snippets</h3>
                    {snippets.map(([key, value]) => (
                      <div key={key} className="space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {key}
                        </p>
                        <Panel tone="sunken" className="overflow-auto p-3">
                          <pre className="text-xs whitespace-pre-wrap break-words">
                            {typeof value === "string"
                              ? value
                              : prettyJson(value)}
                          </pre>
                        </Panel>
                      </div>
                    ))}
                  </div>
                ) : null}

                {pluginInfo.capabilities.config?.supportsApply ? (
                  <Panel tone="sunken" className="space-y-3 p-4">
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
                  </Panel>
                ) : null}
              </>
            )}
          </PanelContent>
        </Panel>
      </div>
    </SettingsPageShell>
  );
}
