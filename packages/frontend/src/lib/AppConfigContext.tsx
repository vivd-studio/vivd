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
  /** Whether org selection comes from session state (not pinned to host). */
  canSelectOrganization: boolean;
}

interface AppConfigContextValue {
  config: AppConfig;
  isLoading: boolean;
}

const defaultConfig: AppConfig = {
  singleProjectMode: false,
  isSuperAdminHost: false,
  canSelectOrganization: false,
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
