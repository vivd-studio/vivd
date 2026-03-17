import type { StudioMachineProvider } from "./types";
import { LocalStudioMachineProvider } from "./local";
import { FlyStudioMachineProvider } from "./fly";
import { DockerStudioMachineProvider } from "./docker";

function getProviderKind(): StudioMachineProvider["kind"] {
  const raw = process.env.STUDIO_MACHINE_PROVIDER;
  if (raw === "fly") return "fly";
  if (raw === "docker") return "docker";
  return "local";
}

export const studioMachineProvider: StudioMachineProvider = (() => {
  const kind = getProviderKind();
  if (kind === "fly") return new FlyStudioMachineProvider();
  if (kind === "docker") return new DockerStudioMachineProvider();
  return new LocalStudioMachineProvider();
})();

export function startStudioMachineReconciler(): void {
  if (studioMachineProvider.kind === "fly") {
    (studioMachineProvider as FlyStudioMachineProvider).startReconciler();
    return;
  }

  if (studioMachineProvider.kind === "docker") {
    (studioMachineProvider as DockerStudioMachineProvider).startReconciler();
  }
}

// Cleanup local studios on process exit (no-op for non-local providers).
process.on("exit", () => {
  if (studioMachineProvider.kind === "local") {
    (studioMachineProvider as LocalStudioMachineProvider).stopAll();
  }
});

process.on("SIGINT", () => {
  if (studioMachineProvider.kind === "local") {
    (studioMachineProvider as LocalStudioMachineProvider).stopAll();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (studioMachineProvider.kind === "local") {
    (studioMachineProvider as LocalStudioMachineProvider).stopAll();
  }
  process.exit(0);
});
