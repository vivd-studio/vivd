import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FlyStudioMachineProvider } from "../src/services/studioMachines/fly/provider";
import type { FlyMachine } from "../src/services/studioMachines/fly/types";

function buildMachine(options: {
  image: string;
  metadataImage?: string;
  accessToken?: string;
}): FlyMachine {
  const accessToken = options.accessToken ?? "test-token";
  return {
    id: "machine-1",
    state: "stopped",
    config: {
      image: options.image,
      env: { STUDIO_ACCESS_TOKEN: accessToken },
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
      services: [{ autostop: "suspend", autostart: false }],
      metadata: {
        ...(options.metadataImage ? { vivd_image: options.metadataImage } : {}),
        vivd_studio_access_token: accessToken,
      },
    },
  };
}

describe("FlyStudioMachineProvider machine drift", () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of [
      "FLY_API_TOKEN",
      "FLY_STUDIO_APP",
      "FLY_STUDIO_CPU_KIND",
      "FLY_STUDIO_CPUS",
      "FLY_STUDIO_MEMORY_MB",
    ]) {
      originalEnv.set(key, process.env[key]);
    }

    // Prevent the provider constructor from starting background intervals / network calls.
    delete process.env.FLY_API_TOKEN;
    delete process.env.FLY_STUDIO_APP;

    process.env.FLY_STUDIO_CPU_KIND = "shared";
    process.env.FLY_STUDIO_CPUS = "1";
    process.env.FLY_STUDIO_MEMORY_MB = "1024";
  });

  afterEach(() => {
    for (const [key, value] of originalEnv) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    originalEnv.clear();
  });

  it("does not flag image drift when vivd_image metadata matches desired", () => {
    const provider = new FlyStudioMachineProvider();
    const desiredImage = "ghcr.io/vivd-studio/vivd-studio:v1.2.3";
    const machine = buildMachine({
      image: "registry.fly.io/vivd-studio:deployment-123",
      metadataImage: desiredImage,
    });

    const reconcileState = (provider as any).resolveMachineReconcileState({
      machine,
      desiredImage,
    }) as { needs: { image: boolean } };

    expect(reconcileState.needs.image).toBe(false);
  });

  it("flags image drift when metadata image is missing and config image differs", () => {
    const provider = new FlyStudioMachineProvider();
    const desiredImage = "ghcr.io/vivd-studio/vivd-studio:v1.2.3";
    const machine = buildMachine({
      image: "ghcr.io/vivd-studio/vivd-studio:v1.2.2",
    });

    const reconcileState = (provider as any).resolveMachineReconcileState({
      machine,
      desiredImage,
    }) as { needs: { image: boolean } };

    expect(reconcileState.needs.image).toBe(true);
  });

  it("still reads vivd_image when metadata contains non-string values", () => {
    const provider = new FlyStudioMachineProvider();
    const desiredImage = "ghcr.io/vivd-studio/vivd-studio:v1.2.3";
    const machine = buildMachine({
      image: "registry.fly.io/vivd-studio:deployment-123",
      metadataImage: desiredImage,
    });

    // Simulate unexpected metadata shapes (Fly or legacy code may inject non-string values).
    (machine.config as any).metadata = {
      ...machine.config?.metadata,
      vivd_image: desiredImage,
      vivd_project_version: 1,
    };

    const reconcileState = (provider as any).resolveMachineReconcileState({
      machine,
      desiredImage,
    }) as { needs: { image: boolean } };

    expect(reconcileState.needs.image).toBe(false);
  });
});
