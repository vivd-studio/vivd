import type { StudioMachineProvider } from "./types";
import { LocalStudioMachineProvider } from "./local";
import { FlyStudioMachineProvider } from "./fly";

function getProviderKind(): StudioMachineProvider["kind"] {
  const raw = process.env.STUDIO_MACHINE_PROVIDER;
  if (raw === "fly") return "fly";
  return "local";
}

export const studioMachineProvider: StudioMachineProvider = (() => {
  const kind = getProviderKind();
  if (kind === "fly") return new FlyStudioMachineProvider();
  return new LocalStudioMachineProvider();
})();

export function startStudioMachineReconciler(): void {
  if (studioMachineProvider.kind !== "fly") return;
  (studioMachineProvider as FlyStudioMachineProvider).startReconciler();
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
