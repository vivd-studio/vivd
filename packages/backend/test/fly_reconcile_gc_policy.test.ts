import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileStudioMachinesInnerWorkflow } from "../src/services/studioMachines/fly/reconcileWorkflow";
import type { MachineReconcileNeeds } from "../src/services/studioMachines/fly/machineModel";
import type { FlyMachine } from "../src/services/studioMachines/fly/types";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function createStudioMachine(options: {
  id: string;
  state: FlyMachine["state"];
  createdAtIso: string;
  organizationId?: string;
  projectSlug?: string;
  version?: number;
}): FlyMachine {
  return {
    id: options.id,
    state: options.state,
    created_at: options.createdAtIso,
    config: {
      metadata: {
        vivd_organization_id: options.organizationId || "org-1",
        vivd_project_slug: options.projectSlug || "site-1",
        vivd_project_version: String(options.version || 1),
      },
    },
  };
}

function createBaseDeps(options: {
  machines: FlyMachine[];
  visitMsByStudioKey?: Map<string, number>;
}) {
  const getMachine = vi.fn(async (machineId: string) => {
    const machine = options.machines.find((item) => item.id === machineId);
    if (!machine) throw new Error(`Missing machine ${machineId}`);
    return machine;
  });
  const stopMachine = vi.fn(async () => {});
  const waitForState = vi.fn(async () => {});
  const destroyMachine = vi.fn(async () => {});

  const deps = {
    getDesiredImage: async () => "ghcr.io/vivd-studio/vivd-studio:v1.2.3",
    listMachines: async () => options.machines,
    maxMachineInactivityMs: 7 * 24 * 60 * 60 * 1000,
    reconcilerDryRun: false,
    getStudioIdentityFromMachine: (machine: FlyMachine) => {
      const metadata = machine.config?.metadata || {};
      const organizationId = metadata.vivd_organization_id;
      const projectSlug = metadata.vivd_project_slug;
      const versionRaw = metadata.vivd_project_version;
      const version = Number.parseInt(String(versionRaw || ""), 10);
      if (!organizationId || !projectSlug || !Number.isFinite(version)) return null;
      return { organizationId, projectSlug, version };
    },
    getStudioKeyForIdentity: (identity: {
      organizationId: string;
      projectSlug: string;
      version: number;
    }) => `${identity.organizationId}:${identity.projectSlug}:v${identity.version}`,
    listStudioVisitMsByIdentity: async () => options.visitMsByStudioKey || new Map(),
    getMachineCreatedAtMs: (machine: FlyMachine) => {
      const value = machine.created_at;
      if (!value) return null;
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : null;
    },
    reconcilerConcurrency: 10,
    getMachine,
    stopMachine,
    waitForState,
    destroyMachine,
    resolveMachineReconcileState: () => ({
      accessToken: "token-1",
      needs: {
        image: false,
        services: false,
        guest: false,
        accessToken: false,
        env: false,
      } satisfies MachineReconcileNeeds,
    }),
    hasMachineDrift: () => false,
    getMachineDriftLabels: () => [],
    warmOutdatedImages: true,
    shouldStopSuspendedBeforeReconcile: () => false,
    getMachineExternalPort: () => 4100,
    resolveStudioIdFromMachine: () => "studio-1",
    buildReconciledMetadata: () => ({}),
    buildReconciledMachineConfig: () => ({}),
    updateMachineConfig: async () => options.machines[0]!,
    waitForReconcileDriftToClear: async () => null,
    trimToken: (value: string | null | undefined) =>
      typeof value === "string" ? value.trim() : null,
    getMachineMetadataValue: () => null,
    startMachineHandlingReplacement: async () => {},
    getPublicUrlForPort: () => "https://studio.example.test",
    waitForReady: async () => {},
    startTimeoutMs: 120_000,
    suspendOrStopMachine: async () => "suspended" as const,
  };

  return { deps, destroyMachine, stopMachine, waitForState };
}

describe("reconcile studio machine GC policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-24T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("destroys machines that have not been visited for at least 7 days", async () => {
    const machine = createStudioMachine({
      id: "machine-1",
      state: "stopped",
      createdAtIso: daysAgoIso(1),
    });
    const visits = new Map<string, number>([
      ["org-1:site-1:v1", Date.now() - 8 * 24 * 60 * 60 * 1000],
    ]);
    const { deps, destroyMachine } = createBaseDeps({
      machines: [machine],
      visitMsByStudioKey: visits,
    });

    const result = await reconcileStudioMachinesInnerWorkflow(deps);

    expect(destroyMachine).toHaveBeenCalledOnce();
    expect(destroyMachine).toHaveBeenCalledWith("machine-1");
    expect(result.destroyedOldMachines).toBe(1);
  });

  it("keeps machines that were visited within the inactivity window", async () => {
    const machine = createStudioMachine({
      id: "machine-2",
      state: "stopped",
      createdAtIso: daysAgoIso(30),
    });
    const visits = new Map<string, number>([
      ["org-1:site-1:v1", Date.now() - 1 * 24 * 60 * 60 * 1000],
    ]);
    const { deps, destroyMachine } = createBaseDeps({
      machines: [machine],
      visitMsByStudioKey: visits,
    });

    const result = await reconcileStudioMachinesInnerWorkflow(deps);

    expect(destroyMachine).not.toHaveBeenCalled();
    expect(result.destroyedOldMachines).toBe(0);
  });

  it("falls back to created-at age when no visit record exists yet", async () => {
    const machine = createStudioMachine({
      id: "machine-3",
      state: "stopped",
      createdAtIso: daysAgoIso(9),
    });
    const { deps, destroyMachine } = createBaseDeps({
      machines: [machine],
      visitMsByStudioKey: new Map(),
    });

    const result = await reconcileStudioMachinesInnerWorkflow(deps);

    expect(destroyMachine).toHaveBeenCalledOnce();
    expect(destroyMachine).toHaveBeenCalledWith("machine-3");
    expect(result.destroyedOldMachines).toBe(1);
  });
});
