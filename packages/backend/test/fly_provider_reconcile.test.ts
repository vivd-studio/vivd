import { describe, expect, it } from "vitest";
import {
  resolveMachineReconcileState,
  STUDIO_ACCESS_TOKEN_ENV_KEY,
} from "../src/services/studioMachines/fly/machineModel";
import type { FlyMachine } from "../src/services/studioMachines/fly/types";

const desiredGuest = { cpu_kind: "shared" as const, cpus: 1, memory_mb: 1024 };

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
      kill_timeout: 180,
      env: { [STUDIO_ACCESS_TOKEN_ENV_KEY]: accessToken },
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
      services: [{ autostop: "suspend", autostart: false }],
      metadata: {
        ...(options.metadataImage ? { vivd_image: options.metadataImage } : {}),
        vivd_studio_access_token: accessToken,
      },
    },
  };
}

describe("Fly machine reconcile model", () => {
  it("does not flag image drift when vivd_image metadata matches desired", () => {
    const desiredImage = "ghcr.io/vivd-studio/vivd-studio:v1.2.3";
    const machine = buildMachine({
      image: "registry.fly.io/vivd-studio:deployment-123",
      metadataImage: desiredImage,
    });

    const reconcileState = resolveMachineReconcileState({
      machine,
      desiredImage,
      desiredGuest,
      generateStudioAccessToken: () => "generated-access-token",
    });

    expect(reconcileState.needs.image).toBe(false);
  });

  it("flags image drift when metadata image is missing and config image differs", () => {
    const desiredImage = "ghcr.io/vivd-studio/vivd-studio:v1.2.3";
    const machine = buildMachine({
      image: "ghcr.io/vivd-studio/vivd-studio:v1.2.2",
    });

    const reconcileState = resolveMachineReconcileState({
      machine,
      desiredImage,
      desiredGuest,
      generateStudioAccessToken: () => "generated-access-token",
    });

    expect(reconcileState.needs.image).toBe(true);
  });

  it("still reads vivd_image when metadata contains non-string values", () => {
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

    const reconcileState = resolveMachineReconcileState({
      machine,
      desiredImage,
      desiredGuest,
      generateStudioAccessToken: () => "generated-access-token",
    });

    expect(reconcileState.needs.image).toBe(false);
  });

  it("flags env drift when the machine keeps a stale session token", () => {
    const desiredImage = "ghcr.io/vivd-studio/vivd-studio:v1.2.3";
    const machine = buildMachine({
      image: desiredImage,
      metadataImage: desiredImage,
    });
    machine.config = {
      ...machine.config,
      env: {
        ...machine.config?.env,
        SESSION_TOKEN: "old-session-token",
      },
    };

    const reconcileState = resolveMachineReconcileState({
      machine,
      desiredImage,
      desiredGuest,
      desiredEnvSubset: {
        SESSION_TOKEN: "fresh-session-token",
      },
      generateStudioAccessToken: () => "generated-access-token",
    });

    expect(reconcileState.needs.env).toBe(true);
  });
});
