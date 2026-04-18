import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { Button } from "@/components/ui/button";
import { useAppConfig } from "@/lib/AppConfigContext";
import { authClient } from "@/lib/auth-client";
import { formatDocumentTitle } from "@/lib/brand";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import {
  getPluginAccessRequestLabel,
  getProjectPluginPresentation,
  isPluginAccessRequestPending,
} from "./presentation";

type ProjectPluginId =
  RouterOutputs["plugins"]["catalog"]["plugins"][number]["pluginId"];
type ProjectPluginInfo = RouterOutputs["plugins"]["info"];

type ProjectPluginPageTitleContext = {
  projectSlug: string;
  projectTitle: string;
  pluginInfo: ProjectPluginInfo | undefined;
  pluginEnabled: boolean;
  pluginEntitled: boolean;
  needsEnable: boolean;
  pluginPresentation: ReturnType<typeof getProjectPluginPresentation>;
};

type ProjectPluginPageModelOptions = {
  projectSlug: string;
  pluginId: string;
  isEmbedded?: boolean;
  documentTitle?: string | ((context: ProjectPluginPageTitleContext) => string);
  updateDocumentTitleWhenEmbedded?: boolean;
  enableToast?: {
    success: string;
    error: string;
  };
  requestAccessToast?: {
    success: string;
    error: string;
  };
  disabledCopy?: string | ((context: ProjectPluginDisabledCopyContext) => string);
  invalidateOnEnable?: (
    context: ProjectPluginMutationContext,
  ) => Array<() => Promise<unknown> | unknown>;
  invalidateOnRequestAccess?: (
    context: ProjectPluginMutationContext,
  ) => Array<() => Promise<unknown> | unknown>;
};

type ProjectPluginActionsBackTarget =
  | "plugins"
  | "project"
  | {
      label: string;
      to: string;
    };

type ProjectPluginAccessActionsProps = {
  canEnablePlugin: boolean;
  canRequestPluginAccess: boolean;
  isEnablePending: boolean;
  isRequestPending: boolean;
  isRequestSubmitting: boolean;
  requestAccessLabel: string;
  onEnable: () => void;
  onRequestAccess: () => void;
  enableLabel?: string;
  enablePendingLabel?: string;
  requestPendingLabel?: string;
  enableVariant?: "default" | "outline" | "secondary" | "ghost" | "link";
  requestVariant?: "default" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
};

type ProjectPluginMutationContext = {
  projectSlug: string;
  typedPluginId: ProjectPluginId;
  utils: ReturnType<typeof trpc.useUtils>;
};

type ProjectPluginDisabledCopyContext = {
  pluginName: string;
  entitlementState: ProjectPluginInfo["entitlementState"] | undefined;
  pluginEnabled: boolean;
  pluginEntitled: boolean;
  needsEnable: boolean;
  canEnablePlugin: boolean;
  isSessionPending: boolean;
};

function runCallbacks(
  callbacks: Array<() => Promise<unknown> | unknown>,
): Promise<unknown[]> {
  return Promise.all(callbacks.map((callback) => callback()));
}

export function useProjectPluginPageModel(
  options: ProjectPluginPageModelOptions,
) {
  const {
    projectSlug,
    pluginId,
    isEmbedded = false,
    documentTitle,
    updateDocumentTitleWhenEmbedded = true,
    enableToast,
    requestAccessToast,
    disabledCopy,
    invalidateOnEnable,
    invalidateOnRequestAccess,
  } = options;
  const { config } = useAppConfig();
  const utils = trpc.useUtils();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const typedPluginId = pluginId as ProjectPluginId;

  const projectListQuery = trpc.project.list.useQuery(undefined, {
    enabled: !!projectSlug,
  });
  const pluginInfoQuery = trpc.plugins.info.useQuery(
    { slug: projectSlug, pluginId: typedPluginId },
    { enabled: Boolean(projectSlug && pluginId) },
  );

  const pluginInfo = pluginInfoQuery.data;
  const projectTitle =
    projectListQuery.data?.projects?.find((project) => project.slug === projectSlug)
      ?.title ?? projectSlug;
  const pluginPresentation = getProjectPluginPresentation(pluginId, projectSlug);
  const PluginIcon = pluginPresentation.icon;
  const pluginName = pluginInfo?.catalog?.name ?? pluginPresentation.title ?? pluginId;
  const canEnablePlugin = session?.user?.role === "super_admin";
  const canRequestPluginAccess =
    !isSessionPending && !canEnablePlugin && Boolean(config.supportEmail);
  const pluginEnabled = !!pluginInfo?.enabled;
  const pluginEntitled =
    pluginInfo?.entitled ?? pluginInfo?.entitlementState === "enabled";
  const needsEnable = pluginEntitled && !pluginEnabled && !pluginInfo?.instanceId;
  const isRequestPending = isPluginAccessRequestPending(pluginInfo?.accessRequest);
  const requestAccessLabel = getPluginAccessRequestLabel(pluginInfo?.accessRequest);
  const disabledCopyContext = {
    pluginName,
    entitlementState: pluginInfo?.entitlementState,
    pluginEnabled,
    pluginEntitled,
    needsEnable,
    canEnablePlugin,
    isSessionPending,
  };
  const resolvedDisabledCopy =
    typeof disabledCopy === "function"
      ? disabledCopy(disabledCopyContext)
      : (disabledCopy ?? getDefaultProjectPluginDisabledCopy(disabledCopyContext));
  const mutationContext = {
    projectSlug,
    typedPluginId,
    utils,
  };

  const invalidatePluginPage = async (
    extraCallbacks: Array<() => Promise<unknown> | unknown> = [],
  ) => {
    await runCallbacks([
      () => utils.plugins.catalog.invalidate({ slug: projectSlug }),
      () =>
        utils.plugins.info.invalidate({
          slug: projectSlug,
          pluginId: typedPluginId,
        }),
      () => utils.project?.list?.invalidate?.(),
      ...extraCallbacks,
    ]);
  };

  const refreshPluginPage = async (
    extraCallbacks: Array<() => Promise<unknown> | unknown> = [],
  ) => {
    await runCallbacks([
      () => projectListQuery.refetch(),
      () => pluginInfoQuery.refetch(),
      ...extraCallbacks,
    ]);
  };

  const ensureMutation = trpc.plugins.ensure.useMutation({
    onSuccess: async () => {
      toast.success(enableToast?.success ?? "Plugin enabled for this project");
      await invalidatePluginPage(invalidateOnEnable?.(mutationContext) ?? []);
    },
    onError: (error) => {
      toast.error(enableToast?.error ?? "Failed to enable plugin", {
        description: error.message,
      });
    },
  });

  const requestAccessMutation = trpc.plugins.requestAccess.useMutation({
    onSuccess: async () => {
      toast.success(requestAccessToast?.success ?? "Access request sent");
      await runCallbacks([
        () =>
          utils.plugins.info.invalidate({
            slug: projectSlug,
            pluginId: typedPluginId,
          }),
        ...(invalidateOnRequestAccess?.(mutationContext) ?? []),
      ]);
    },
    onError: (error) => {
      toast.error(requestAccessToast?.error ?? "Failed to send access request", {
        description: error.message,
      });
    },
  });

  useEffect(() => {
    if (!documentTitle) return;
    if (isEmbedded && !updateDocumentTitleWhenEmbedded) return;

    const value =
      typeof documentTitle === "function"
        ? documentTitle({
            projectSlug,
            projectTitle,
            pluginInfo,
            pluginEnabled,
            pluginEntitled,
            needsEnable,
            pluginPresentation,
          })
        : documentTitle;

    if (!value) return;

    document.title = formatDocumentTitle(value);
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [
    documentTitle,
    isEmbedded,
    needsEnable,
    pluginEnabled,
    pluginEntitled,
    pluginInfo,
    pluginPresentation,
    projectSlug,
    projectTitle,
    updateDocumentTitleWhenEmbedded,
  ]);

  return {
    utils,
    session,
    isSessionPending,
    typedPluginId,
    pluginInfo,
    pluginInfoQuery,
    projectListQuery,
    projectTitle,
    pluginName,
    pluginPresentation,
    PluginIcon,
    canEnablePlugin,
    canRequestPluginAccess,
    pluginEnabled,
    pluginEntitled,
    needsEnable,
    isRequestPending,
    requestAccessLabel,
    disabledCopy: resolvedDisabledCopy,
    ensureMutation,
    requestAccessMutation,
    invalidatePluginPage,
    refreshPluginPage,
  };
}

function getDefaultProjectPluginDisabledCopy(
  context: ProjectPluginDisabledCopyContext,
): string {
  const {
    pluginName,
    entitlementState,
    needsEnable,
    canEnablePlugin,
    isSessionPending,
  } = context;

  if (needsEnable || entitlementState === "enabled") {
    if (isSessionPending) {
      return `${pluginName} is available for this instance but has not been enabled for this project yet.`;
    }
    return canEnablePlugin
      ? `${pluginName} is available for this instance but has not been enabled for this project yet.`
      : `${pluginName} is available for this instance, but a super-admin still needs to enable it for this project.`;
  }

  if (entitlementState === "suspended") {
    return canEnablePlugin
      ? `${pluginName} is suspended for this project. You can enable it again directly here.`
      : `${pluginName} is suspended for this project.`;
  }

  return canEnablePlugin
    ? `${pluginName} is not active for this project yet. You can enable it directly here.`
    : `${pluginName} access is managed in the admin plugin settings. Ask a super-admin to enable it for this project.`;
}

export function ProjectPluginPageActions(props: {
  projectSlug: string;
  isEmbedded?: boolean;
  backTarget?: ProjectPluginActionsBackTarget | null;
  onRefresh: () => void;
  isRefreshing?: boolean;
  children?: ReactNode;
}) {
  const {
    projectSlug,
    isEmbedded = false,
    backTarget = "plugins",
    onRefresh,
    isRefreshing = false,
    children,
  } = props;

  const resolvedBackTarget =
    backTarget === "plugins"
      ? {
          label: "Back to plugins",
          to: ROUTES.PROJECT_PLUGINS(projectSlug),
        }
      : backTarget === "project"
        ? {
            label: "Back to project",
            to: ROUTES.PROJECT(projectSlug),
          }
        : backTarget;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!isEmbedded && resolvedBackTarget ? (
        <Button variant="outline" asChild>
          <Link to={resolvedBackTarget.to}>{resolvedBackTarget.label}</Link>
        </Button>
      ) : null}
      <Button variant="outline" onClick={onRefresh} disabled={isRefreshing}>
        <RefreshCw className="h-4 w-4" />
        Refresh
      </Button>
      {children}
    </div>
  );
}

export function ProjectPluginAccessActions(
  props: ProjectPluginAccessActionsProps,
) {
  const {
    canEnablePlugin,
    canRequestPluginAccess,
    isEnablePending,
    isRequestPending,
    isRequestSubmitting,
    requestAccessLabel,
    onEnable,
    onRequestAccess,
    enableLabel = "Enable for this project",
    enablePendingLabel = "Enabling...",
    requestPendingLabel = "Sending...",
    enableVariant = "outline",
    requestVariant = "outline",
    size = "sm",
  } = props;

  return (
    <>
      {canEnablePlugin ? (
        <Button
          size={size}
          variant={enableVariant}
          onClick={onEnable}
          disabled={isEnablePending}
        >
          {isEnablePending ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              {enablePendingLabel}
            </>
          ) : (
            enableLabel
          )}
        </Button>
      ) : null}
      {canRequestPluginAccess ? (
        <Button
          size={size}
          variant={requestVariant}
          onClick={onRequestAccess}
          disabled={isRequestPending || isRequestSubmitting}
        >
          {isRequestSubmitting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              {requestPendingLabel}
            </>
          ) : (
            requestAccessLabel
          )}
        </Button>
      ) : null}
    </>
  );
}
