import type {
  StudioMachineProvider,
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "./types";

export class FlyStudioMachineProvider implements StudioMachineProvider {
  kind = "fly" as const;

  async ensureRunning(
    _args: StudioMachineStartArgs
  ): Promise<StudioMachineStartResult> {
    throw new Error(
      "Fly studio machine provider is not implemented yet. Set STUDIO_MACHINE_PROVIDER=local for development."
    );
  }

  stop(_projectSlug: string, _version: number): void {
    throw new Error(
      "Fly studio machine provider is not implemented yet. Set STUDIO_MACHINE_PROVIDER=local for development."
    );
  }

  getUrl(_projectSlug: string, _version: number): string | null {
    return null;
  }

  isRunning(_projectSlug: string, _version: number): boolean {
    return false;
  }
}

