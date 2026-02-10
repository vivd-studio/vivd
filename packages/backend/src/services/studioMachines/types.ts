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

export interface StudioMachineStartResult {
  studioId: string;
  url: string;
  port?: number;
}

export interface StudioMachineProvider {
  kind: StudioMachineProviderKind;

  ensureRunning(args: StudioMachineStartArgs): Promise<StudioMachineStartResult>;
  touch(organizationId: string, projectSlug: string, version: number): void | Promise<void>;
  stop(organizationId: string, projectSlug: string, version: number): void | Promise<void>;
  getUrl(organizationId: string, projectSlug: string, version: number): Promise<string | null>;
  isRunning(organizationId: string, projectSlug: string, version: number): Promise<boolean>;
}
