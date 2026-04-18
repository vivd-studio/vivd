import * as React from "react";
import type { Location, NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { type AppConfig } from "@/lib/AppConfigContext";
import { trpc } from "@/lib/trpc";
import {
  buildTenantStudioUrl,
  inferControlPlaneHostFallback,
  ORG_SWITCH_QUERY_KEY,
  type SidebarOrganization,
  type SwitcherOrganization,
} from "./helpers";

type UseAppSidebarOrganizationSwitchingArgs = {
  hasSession: boolean;
  config: AppConfig;
  location: Location;
  navigate: NavigateFunction;
};

type UseAppSidebarOrganizationSwitchingResult = {
  org: SidebarOrganization;
  organizations: SwitcherOrganization[];
  isSwitching: boolean;
  onSelectOrganization: (organizationId: string) => void;
};

export function useAppSidebarOrganizationSwitching({
  hasSession,
  config,
  location,
  navigate,
}: UseAppSidebarOrganizationSwitchingArgs): UseAppSidebarOrganizationSwitchingResult {
  const utils = trpc.useUtils();
  const { data: orgData } = trpc.organization.getMyOrganization.useQuery(undefined, {
    enabled: hasSession && config.hasHostOrganizationAccess,
  });
  const { data: organizationsData } = trpc.organization.listMyOrganizations.useQuery(
    undefined,
    { enabled: hasSession },
  );
  const setActiveOrganizationMutation = trpc.organization.setActiveOrganization.useMutation();
  const organizations = organizationsData?.organizations ?? [];
  const searchParams = React.useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const org = orgData?.organization
    ? {
        id: orgData.organization.id,
        name: orgData.organization.name,
        status: orgData.organization.status,
      }
    : null;

  React.useEffect(() => {
    const switchOrg = searchParams.get(ORG_SWITCH_QUERY_KEY);
    if (!switchOrg) return;
    if (!config.canSelectOrganization) return;

    // Clear param early to avoid retry loops on navigation errors.
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete(ORG_SWITCH_QUERY_KEY);
    navigate(
      {
        pathname: location.pathname,
        search: nextParams.toString() ? `?${nextParams.toString()}` : "",
      },
      { replace: true },
    );

    setActiveOrganizationMutation.mutate(
      { organizationId: switchOrg },
      {
        onSuccess: async (result) => {
          await utils.invalidate();
          const tenantHost = result.tenantHost;
          if (tenantHost) {
            window.location.assign(buildTenantStudioUrl(tenantHost, window.location.host));
          } else {
            navigate(ROUTES.DASHBOARD);
          }
        },
        onError: (error) => {
          toast.error("Failed to switch organization", { description: error.message });
        },
      },
    );
  }, [
    config.canSelectOrganization,
    location.pathname,
    location.search,
    navigate,
    searchParams,
    setActiveOrganizationMutation,
    utils,
  ]);

  const onSelectOrganization = React.useCallback(
    (organizationId: string) => {
      const target = organizations.find((entry) => entry.id === organizationId);
      if (!target) return;

      const redirectToTarget = (tenantHost: string) => {
        console.info(
          `[OrgSwitch] redirecting from ${window.location.host} to ${tenantHost}`,
        );
        window.location.assign(buildTenantStudioUrl(tenantHost, window.location.host));
      };

      if (!config.canSelectOrganization) {
        if (target.tenantHost) {
          redirectToTarget(target.tenantHost);
          return;
        }

        const controlPlaneHost =
          config.controlPlaneHost ?? inferControlPlaneHostFallback(window.location.host);
        if (!controlPlaneHost) {
          toast.error("Control plane host is not configured", {
            description:
              "Set CONTROL_PLANE_HOST (or open Studio on the control plane domain).",
          });
          return;
        }

        const controlPlaneUrl = new URL(
          buildTenantStudioUrl(controlPlaneHost, window.location.host),
        );
        controlPlaneUrl.searchParams.set(ORG_SWITCH_QUERY_KEY, target.id);
        console.info(
          `[OrgSwitch] redirecting from ${window.location.host} to control plane ${controlPlaneHost} to switch org`,
        );
        window.location.assign(controlPlaneUrl.toString());
        return;
      }

      setActiveOrganizationMutation.mutate(
        { organizationId },
        {
          onSuccess: async (result) => {
            await utils.invalidate();
            const tenantHost = result.tenantHost ?? target.tenantHost;
            if (tenantHost) {
              redirectToTarget(tenantHost);
            } else {
              navigate(ROUTES.DASHBOARD);
            }
          },
          onError: (error) => {
            toast.error("Failed to switch organization", { description: error.message });
          },
        },
      );
    },
    [
      config.canSelectOrganization,
      config.controlPlaneHost,
      navigate,
      organizations,
      setActiveOrganizationMutation,
      utils,
    ],
  );

  return {
    org,
    organizations,
    isSwitching: setActiveOrganizationMutation.isPending,
    onSelectOrganization,
  };
}
