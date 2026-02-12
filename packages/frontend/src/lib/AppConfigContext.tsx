import { createContext, useContext, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";

/**
 * App configuration exposed from the backend.
 * This enables features like single project mode to be controlled via env vars.
 */
export interface AppConfig {
  /** When true, the app operates with a single project and bypasses the project list */
  singleProjectMode: boolean;
  /** Whether the current host is allowed to show super-admin UI. */
  isSuperAdminHost: boolean;
  /** Host classification from backend routing context. */
  hostKind: "control_plane_host" | "tenant_host" | "published_domain" | "unknown";
  /** Whether org selection comes from session state (not pinned to host). */
  canSelectOrganization: boolean;
  /** Org slug pinned by tenant host, if current host is a tenant host. */
  tenantHostOrgSlug: string | null;
  /** Org id pinned by host (tenant host / published domain). */
  hostOrganizationId: string | null;
  /** Whether current user can access the host-pinned org. */
  hasHostOrganizationAccess: boolean;
  /** Canonical control-plane host for cross-tenant recovery flows. */
  controlPlaneHost: string | null;
  /** Active organization tenant host (if available). */
  activeOrganizationTenantHost: string | null;
}

interface AppConfigContextValue {
  config: AppConfig;
  isLoading: boolean;
}

const defaultConfig: AppConfig = {
  singleProjectMode: false,
  isSuperAdminHost: false,
  hostKind: "unknown",
  canSelectOrganization: false,
  tenantHostOrgSlug: null,
  hostOrganizationId: null,
  hasHostOrganizationAccess: true,
  controlPlaneHost: null,
  activeOrganizationTenantHost: null,
};

const AppConfigContext = createContext<AppConfigContextValue>({
  config: defaultConfig,
  isLoading: true,
});

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = trpc.config.getAppConfig.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes - config doesn't change often
    refetchOnWindowFocus: false,
  });

  const config: AppConfig = data ?? defaultConfig;

  return (
    <AppConfigContext.Provider value={{ config, isLoading }}>
      {children}
    </AppConfigContext.Provider>
  );
}

/**
 * Hook to access app configuration.
 * Use this to check feature flags like singleProjectMode.
 */
export function useAppConfig(): AppConfigContextValue {
  return useContext(AppConfigContext);
}
