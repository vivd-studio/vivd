export type StudioMachineProviderKind = "local" | "fly";

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
  port?: number;
  accessToken?: string;
}

export interface StudioMachineUrlResult {
  url: string;
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
}
