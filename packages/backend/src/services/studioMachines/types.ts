export type StudioMachineProviderKind = "local" | "fly";

export interface StudioMachineStartArgs {
  projectSlug: string;
  version: number;
  /**
   * Environment variables that must be injected into the studio machine.
   * This is how connected-mode is enabled for @vivd/studio.
   */
  env: Record<string, string | undefined>;
}

export interface StudioMachineStartResult {
  studioId: string;
  url: string;
  port?: number;
}

export interface StudioMachineProvider {
  kind: StudioMachineProviderKind;

  ensureRunning(args: StudioMachineStartArgs): Promise<StudioMachineStartResult>;
  stop(projectSlug: string, version: number): void | Promise<void>;
  getUrl(projectSlug: string, version: number): string | null;
  isRunning(projectSlug: string, version: number): boolean;
}
