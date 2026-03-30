export type StudioMachineProviderKind = "local" | "fly" | "docker";

export interface StudioMachineStartArgs {
  organizationId: string;
  projectSlug: string;
  version: number;
  /**
   * Environment variables that must be injected into the studio machine.
   * This is how connected-mode is enabled for @vivd/studio.
   */
  env: Record<string, string | undefined>;
}

export type StudioMachineRestartMode = "soft" | "hard";

export interface StudioMachineRestartArgs extends StudioMachineStartArgs {
  /**
   * soft: prefer resuming an existing machine (fastest).
   * hard: force a fresh boot (re-runs S3 hydration on startup).
   */
  mode?: StudioMachineRestartMode;
}

export interface StudioMachineStartResult {
  studioId: string;
  url: string;
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
  port?: number;
  accessToken?: string;
}

export type StudioRuntimeAuthIdentity = {
  studioId: string;
  organizationId: string;
  projectSlug: string;
  version: number;
};

export interface StudioMachineUrlResult {
  studioId: string;
  url: string;
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
  accessToken?: string;
}

export interface StudioMachineProvider {
  kind: StudioMachineProviderKind;

  ensureRunning(args: StudioMachineStartArgs): Promise<StudioMachineStartResult>;
  restart(args: StudioMachineRestartArgs): Promise<StudioMachineStartResult>;
  touch(organizationId: string, projectSlug: string, version: number): void | Promise<void>;
  stop(organizationId: string, projectSlug: string, version: number): void | Promise<void>;
  getUrl(
    organizationId: string,
    projectSlug: string,
    version: number,
  ): Promise<StudioMachineUrlResult | null>;
  isRunning(organizationId: string, projectSlug: string, version: number): Promise<boolean>;
  resolveRuntimeAuth?(
    studioId: string,
    accessToken: string,
  ): Promise<StudioRuntimeAuthIdentity | null>;
}

export interface StudioMachineSummary {
  id: string;
  name: string | null;
  state: string | null;
  region: string | null;
  cpuKind: string | null;
  cpus: number | null;
  memoryMb: number | null;
  organizationId: string;
  projectSlug: string;
  version: number;
  externalPort: number | null;
  routePath: string | null;
  url: string | null;
  runtimeUrl: string | null;
  compatibilityUrl: string | null;
  image: string | null;
  desiredImage: string;
  imageOutdated: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StudioMachineReconcileResult {
  desiredImage: string;
  scanned: number;
  warmedOutdatedImages: number;
  destroyedOldMachines: number;
  skippedRunningMachines: number;
  dryRun: boolean;
  errors: Array<{
    machineId: string;
    action: "gc" | "warm_reconciled_machine";
    message: string;
  }>;
}

export type StudioMachineParkResult = "suspended" | "stopped";

export interface ManagedStudioMachineProvider extends StudioMachineProvider {
  listStudioMachines(): Promise<StudioMachineSummary[]>;
  reconcileStudioMachine(
    machineId: string,
    options?: { forceRefreshDesiredImage?: boolean },
  ): Promise<{ desiredImage: string }>;
  parkStudioMachine(machineId: string): Promise<StudioMachineParkResult>;
  destroyStudioMachine(machineId: string): Promise<void>;
  invalidateDesiredImageCache(): void;
  getDesiredImage(options?: { forceRefresh?: boolean }): Promise<string>;
  reconcileStudioMachines(options?: {
    forceRefreshDesiredImage?: boolean;
  }): Promise<StudioMachineReconcileResult>;
}

export function isManagedStudioMachineProvider(
  provider: StudioMachineProvider,
): provider is ManagedStudioMachineProvider {
  const candidate = provider as Partial<ManagedStudioMachineProvider>;
  const isManagedKind = candidate.kind === "fly" || candidate.kind === "docker";
  return (
    isManagedKind &&
    typeof candidate.listStudioMachines === "function" &&
    typeof candidate.reconcileStudioMachine === "function" &&
    typeof candidate.parkStudioMachine === "function" &&
    typeof candidate.destroyStudioMachine === "function" &&
    typeof candidate.invalidateDesiredImageCache === "function" &&
    typeof candidate.getDesiredImage === "function" &&
    typeof candidate.reconcileStudioMachines === "function"
  );
}
