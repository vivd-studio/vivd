import type { MachineReconcileNeeds } from "./machineModel";
import type {
  FlyMachine,
  FlyMachineConfig,
  FlyMachineState,
  FlyStudioMachineReconcileResult,
} from "./types";
import { sleep } from "./utils";

type StudioIdentity = {
  organizationId: string;
  projectSlug: string;
  version: number;
};

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const concurrency = Math.max(1, Math.floor(limit));
  let index = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = index++;
        if (i >= items.length) return;
        await worker(items[i]!);
      }
    },
  );

  await Promise.all(runners);
}

type WaitForStateOptions = {
  machineId: string;
  state: FlyMachineState;
  timeoutMs: number;
};

type WaitForReadyOptions = {
  machineId: string;
  url: string;
  timeoutMs: number;
};

const POST_RUNTIME_CLEANUP_DRAIN_MS = 3_000;

function hasOnlyImageDrift(needs: MachineReconcileNeeds): boolean {
  return (
    needs.image &&
    !needs.services &&
    !needs.guest &&
    !needs.accessToken &&
    !needs.env
  );
}

async function waitForMachineToLeaveReplacingState(options: {
  machineId: string;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  timeoutMs: number;
}): Promise<FlyMachine> {
  const startedAt = Date.now();
  let delayMs = 750;
  let machine = await options.getMachine(options.machineId);

  while ((machine.state || "unknown") === "replacing") {
    if (Date.now() - startedAt >= options.timeoutMs) {
      throw new Error(
        `[FlyMachines] Timed out waiting for machine to finish replacement (${options.machineId})`,
      );
    }

    await sleep(delayMs);
    delayMs = Math.min(5000, Math.round(delayMs * 1.4));
    machine = await options.getMachine(options.machineId);
  }

  return machine;
}

export type WarmReconcileStudioMachineDeps = {
  getDesiredImage: () => Promise<string>;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  getStudioIdentityFromMachine: (machine: FlyMachine) => StudioIdentity | null;
  buildReconciledEnv: (options: {
    machine: FlyMachine;
    organizationId: string;
    projectSlug: string;
    version: number;
    studioId: string;
    accessToken: string;
  }) => {
    desiredEnvSubset: Record<string, string>;
    fullEnv: Record<string, string>;
  } | Promise<{
    desiredEnvSubset: Record<string, string>;
    fullEnv: Record<string, string>;
  }>;
  resolveMachineReconcileState: (options: {
    machine: FlyMachine;
    desiredImage: string;
    preferredAccessToken?: string | null;
    desiredEnvSubset?: Record<string, string>;
  }) => { accessToken: string; needs: MachineReconcileNeeds };
  hasMachineDrift: (needs: MachineReconcileNeeds) => boolean;
  shouldStopSuspendedBeforeReconcile: (
    state: string | undefined,
    needs: MachineReconcileNeeds,
  ) => boolean;
  stopMachine: (machineId: string) => Promise<void>;
  waitForState: (options: WaitForStateOptions) => Promise<void>;
  getMachineExternalPort: (machine: FlyMachine) => number | null;
  resolveStudioIdFromMachine: (machine: FlyMachine, fallback?: string | null) => string;
  buildReconciledMetadata: (options: {
    machine: FlyMachine;
    organizationId: string;
    projectSlug: string;
    version: number;
    port: number;
    studioId: string;
    desiredImage: string;
    accessToken: string;
    extra?: Record<string, string>;
  }) => Record<string, string>;
  buildReconciledMachineConfig: (options: {
    machine: FlyMachine;
    port: number;
    desiredImage: string;
    accessToken: string;
    needs: MachineReconcileNeeds;
    metadata: Record<string, string>;
    fullEnv?: Record<string, string>;
  }) => FlyMachineConfig;
  updateMachineConfig: (options: {
    machineId: string;
    config: FlyMachineConfig;
    skipLaunch?: boolean;
  }) => Promise<FlyMachine>;
  getMachineDriftLabels: (needs: MachineReconcileNeeds) => string[];
  trimToken: (value: string | null | undefined) => string | null;
  getMachineMetadataValue: (machine: FlyMachine, key: string) => string | null;
  startMachineHandlingReplacement: (machineId: string, timeoutMs?: number) => Promise<void>;
  requestRuntimeCleanup: (url: string, accessToken: string) => Promise<void>;
  getPublicUrlForPort: (port: number) => string;
  waitForReady: (options: WaitForReadyOptions) => Promise<void>;
  startTimeoutMs: number;
  suspendOrStopMachine: (machineId: string) => Promise<"suspended" | "stopped">;
};

export async function warmReconcileStudioMachineWorkflow(
  deps: WarmReconcileStudioMachineDeps,
  machineId: string,
): Promise<{ desiredImage: string }> {
  const desiredImage = await deps.getDesiredImage();
  const replacementTimeoutMs = deps.startTimeoutMs;

  const machine = await waitForMachineToLeaveReplacingState({
    machineId,
    getMachine: deps.getMachine,
    timeoutMs: replacementTimeoutMs,
  });
  const identity = deps.getStudioIdentityFromMachine(machine);
  if (!identity) {
    throw new Error(
      `[FlyMachines] Refusing to warm reconcile non-studio machine ${machineId}`,
    );
  }

  const state = machine.state || "unknown";
  if (state === "destroyed" || state === "destroying") {
    return { desiredImage };
  }

  const studioId = deps.resolveStudioIdFromMachine(machine);
  let reconcileState = deps.resolveMachineReconcileState({
    machine,
    desiredImage,
  });
  let reconcileEnv = await deps.buildReconciledEnv({
    machine,
    organizationId: identity.organizationId,
    projectSlug: identity.projectSlug,
    version: identity.version,
    studioId,
    accessToken: reconcileState.accessToken,
  });
  reconcileState = deps.resolveMachineReconcileState({
    machine,
    desiredImage,
    preferredAccessToken: reconcileState.accessToken,
    desiredEnvSubset: reconcileEnv.desiredEnvSubset,
  });
  if (!deps.hasMachineDrift(reconcileState.needs)) {
    return { desiredImage };
  }

  if (state === "started" || state === "starting") {
    throw new Error(
      `[FlyMachines] Refusing to warm reconcile running machine ${machineId} (state=${state})`,
    );
  }
  let current = machine;
  let currentState = state;
  let currentReconcileState = reconcileState;
  let currentReconcileEnv = reconcileEnv;

  // Suspended machines would resume a snapshot; stop first to boot the new image.
  if (deps.shouldStopSuspendedBeforeReconcile(currentState, currentReconcileState.needs)) {
    await deps.stopMachine(machineId);
    await deps.waitForState({
      machineId,
      state: "stopped",
      timeoutMs: 60_000,
    });
    current = await waitForMachineToLeaveReplacingState({
      machineId,
      getMachine: deps.getMachine,
      timeoutMs: replacementTimeoutMs,
    });
    currentState = current.state || "unknown";
    const currentStudioId = deps.resolveStudioIdFromMachine(current, studioId);
    currentReconcileEnv = await deps.buildReconciledEnv({
      machine: current,
      organizationId: identity.organizationId,
      projectSlug: identity.projectSlug,
      version: identity.version,
      studioId: currentStudioId,
      accessToken: currentReconcileState.accessToken,
    });
    currentReconcileState = deps.resolveMachineReconcileState({
      machine: current,
      desiredImage,
      preferredAccessToken: currentReconcileState.accessToken,
      desiredEnvSubset: currentReconcileEnv.desiredEnvSubset,
    });
  }

  if (!deps.hasMachineDrift(currentReconcileState.needs)) {
    return { desiredImage };
  }

  if (currentState !== "stopped") {
    throw new Error(
      `[FlyMachines] Cannot warm reconcile machine ${machineId}; expected state=stopped but got state=${currentState}`,
    );
  }

  const port = deps.getMachineExternalPort(current);
  if (!port) {
    throw new Error("Missing external port; cannot warm image");
  }
  const currentStudioId = deps.resolveStudioIdFromMachine(current, studioId);
  const accessToken = currentReconcileState.accessToken;
  const reconciledAt = new Date().toISOString();
  const metadata = deps.buildReconciledMetadata({
    machine: current,
    organizationId: identity.organizationId,
    projectSlug: identity.projectSlug,
    version: identity.version,
    port,
    studioId: currentStudioId,
    desiredImage,
    accessToken,
    extra: {
      vivd_last_machine_reconcile_at: reconciledAt,
      ...(currentReconcileState.needs.image ? { vivd_last_image_reconcile_at: reconciledAt } : {}),
    },
  });

  const config = deps.buildReconciledMachineConfig({
    machine: current,
    port,
    desiredImage,
    accessToken,
    needs: currentReconcileState.needs,
    metadata,
    fullEnv: currentReconcileEnv.fullEnv,
  });

  await deps.updateMachineConfig({
    machineId,
    config,
    skipLaunch: true,
  });

  const refreshedAfterConfigUpdate = await deps.getMachine(machineId);
  const postUpdateDrift = deps.resolveMachineReconcileState({
    machine: refreshedAfterConfigUpdate,
    desiredImage,
    preferredAccessToken: accessToken,
    desiredEnvSubset: currentReconcileEnv.desiredEnvSubset,
  }).needs;
  if (deps.hasMachineDrift(postUpdateDrift) && !hasOnlyImageDrift(postUpdateDrift)) {
    const driftLabels = deps.getMachineDriftLabels(postUpdateDrift).join(",");
    const configImage =
      typeof refreshedAfterConfigUpdate.config?.image === "string"
        ? refreshedAfterConfigUpdate.config.image
        : null;
    const metadataImage = deps.trimToken(
      deps.getMachineMetadataValue(refreshedAfterConfigUpdate, "vivd_image"),
    );
    console.warn(
      `[FlyMachines] Warm reconcile drift did not clear for ${machineId} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) after config update (drift=${driftLabels}) desiredImage=${desiredImage} configImage=${configImage} vivd_image=${metadataImage}`,
    );
  }

  await deps.startMachineHandlingReplacement(machineId, replacementTimeoutMs);
  const url = deps.getPublicUrlForPort(port);
  await deps.waitForReady({
    machineId,
    url,
    timeoutMs: Math.min(deps.startTimeoutMs, 120_000),
  });
  await deps.requestRuntimeCleanup(url, accessToken);
  await sleep(POST_RUNTIME_CLEANUP_DRAIN_MS);

  const parked = await deps.suspendOrStopMachine(machineId);
  if (parked !== "suspended") {
    throw new Error(
      `[FlyMachines] Warm reconcile parked machine ${machineId} in state=${parked}; expected suspended`,
    );
  }

  return { desiredImage };
}

export type ReconcileStudioMachinesInnerDeps = {
  getDesiredImage: () => Promise<string>;
  listMachines: () => Promise<FlyMachine[]>;
  maxMachineInactivityMs: number;
  reconcilerDryRun: boolean;
  getStudioIdentityFromMachine: (machine: FlyMachine) => StudioIdentity | null;
  getStudioKeyForIdentity: (identity: StudioIdentity) => string;
  listStudioVisitMsByIdentity: (
    identities: StudioIdentity[],
  ) => Promise<Map<string, number>>;
  getMachineCreatedAtMs: (machine: FlyMachine) => number | null;
  reconcilerConcurrency: number;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  buildReconciledEnv: (options: {
    machine: FlyMachine;
    organizationId: string;
    projectSlug: string;
    version: number;
    studioId: string;
    accessToken: string;
  }) => {
    desiredEnvSubset: Record<string, string>;
    fullEnv: Record<string, string>;
  } | Promise<{
    desiredEnvSubset: Record<string, string>;
    fullEnv: Record<string, string>;
  }>;
  stopMachine: (machineId: string) => Promise<void>;
  waitForState: (options: WaitForStateOptions) => Promise<void>;
  destroyMachine: (machineId: string) => Promise<void>;
  resolveMachineReconcileState: (options: {
    machine: FlyMachine;
    desiredImage: string;
    preferredAccessToken?: string | null;
    desiredEnvSubset?: Record<string, string>;
  }) => { accessToken: string; needs: MachineReconcileNeeds };
  hasMachineDrift: (needs: MachineReconcileNeeds) => boolean;
  getMachineDriftLabels: (needs: MachineReconcileNeeds) => string[];
  warmOutdatedImages: boolean;
  shouldStopSuspendedBeforeReconcile: (
    state: string | undefined,
    needs: MachineReconcileNeeds,
  ) => boolean;
  getMachineExternalPort: (machine: FlyMachine) => number | null;
  resolveStudioIdFromMachine: (machine: FlyMachine, fallback?: string | null) => string;
  buildReconciledMetadata: (options: {
    machine: FlyMachine;
    organizationId: string;
    projectSlug: string;
    version: number;
    port: number;
    studioId: string;
    desiredImage: string;
    accessToken: string;
    extra?: Record<string, string>;
  }) => Record<string, string>;
  buildReconciledMachineConfig: (options: {
    machine: FlyMachine;
    port: number;
    desiredImage: string;
    accessToken: string;
    needs: MachineReconcileNeeds;
    metadata: Record<string, string>;
    fullEnv?: Record<string, string>;
  }) => FlyMachineConfig;
  updateMachineConfig: (options: {
    machineId: string;
    config: FlyMachineConfig;
    skipLaunch?: boolean;
  }) => Promise<FlyMachine>;
  trimToken: (value: string | null | undefined) => string | null;
  getMachineMetadataValue: (machine: FlyMachine, key: string) => string | null;
  startMachineHandlingReplacement: (machineId: string, timeoutMs?: number) => Promise<void>;
  requestRuntimeCleanup: (url: string, accessToken: string) => Promise<void>;
  getPublicUrlForPort: (port: number) => string;
  waitForReady: (options: WaitForReadyOptions) => Promise<void>;
  startTimeoutMs: number;
  suspendOrStopMachine: (machineId: string) => Promise<"suspended" | "stopped">;
};

export async function reconcileStudioMachinesInnerWorkflow(
  deps: ReconcileStudioMachinesInnerDeps,
): Promise<FlyStudioMachineReconcileResult> {
  const desiredImage = await deps.getDesiredImage();
  const replacementTimeoutMs = deps.startTimeoutMs;
  const machines = await deps.listMachines();
  const now = Date.now();
  const maxInactivityMs = deps.maxMachineInactivityMs;
  const dryRun = deps.reconcilerDryRun;

  const result: FlyStudioMachineReconcileResult = {
    desiredImage,
    scanned: 0,
    warmedOutdatedImages: 0,
    destroyedOldMachines: 0,
    skippedRunningMachines: 0,
    dryRun,
    errors: [],
  };

  const studioMachines = machines.flatMap((machine) => {
    const identity = deps.getStudioIdentityFromMachine(machine);
    return identity ? [{ machine, identity }] : [];
  });
  result.scanned = studioMachines.length;
  const lastVisitedAtMsByStudioKey = await deps.listStudioVisitMsByIdentity(
    studioMachines.map(({ identity }) => identity),
  );

  await mapLimit(studioMachines, deps.reconcilerConcurrency, async ({ machine, identity }) => {
    const studioKey = deps.getStudioKeyForIdentity(identity);
    const lastVisitedAtMs = lastVisitedAtMsByStudioKey.get(studioKey) ?? null;
    const inactivityMs = lastVisitedAtMs !== null ? now - lastVisitedAtMs : null;
    const createdAtMs = deps.getMachineCreatedAtMs(machine);
    const createdAgeMs = createdAtMs !== null ? now - createdAtMs : null;
    const isInactive = inactivityMs !== null && inactivityMs >= maxInactivityMs;
    const isInactiveByCreatedAtFallback =
      lastVisitedAtMs === null &&
      createdAgeMs !== null &&
      createdAgeMs >= maxInactivityMs;
    const shouldGc = isInactive || isInactiveByCreatedAtFallback;

    // Prefer GC over image warmups for inactive machines.
    if (shouldGc) {
      const state = machine.state || "unknown";
      if (state === "destroyed" || state === "destroying") return;
      const reason = isInactive ? "inactivity" : "created_at_fallback";
      const ageDays = isInactive
        ? Math.floor((inactivityMs || 0) / (24 * 60 * 60 * 1000))
        : Math.floor((createdAgeMs || 0) / (24 * 60 * 60 * 1000));

      if (dryRun) {
        console.log(
          `[FlyMachines] (dry-run) GC inactive machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) state=${state} reason=${reason} ageDays=${ageDays}`,
        );
        return;
      }

      try {
        const current = await deps.getMachine(machine.id);
        const currentState = current.state || "unknown";

        if (
          currentState !== "stopped" &&
          currentState !== "destroyed" &&
          currentState !== "destroying"
        ) {
          await deps.stopMachine(machine.id);
          await deps.waitForState({
            machineId: machine.id,
            state: "stopped",
            timeoutMs: 60_000,
          });
        }

        await deps.destroyMachine(machine.id);
        result.destroyedOldMachines++;
        console.log(
          `[FlyMachines] Destroyed inactive machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) reason=${reason} ageDays=${ageDays}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({
          machineId: machine.id,
          action: "gc",
          message,
        });
        console.warn(
          `[FlyMachines] GC failed for machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}): ${message}`,
        );
      }

      return;
    }

    const studioId = deps.resolveStudioIdFromMachine(machine);
    let reconcileState = deps.resolveMachineReconcileState({
      machine,
      desiredImage,
    });
    let reconcileEnv = await deps.buildReconciledEnv({
      machine,
      organizationId: identity.organizationId,
      projectSlug: identity.projectSlug,
      version: identity.version,
      studioId,
      accessToken: reconcileState.accessToken,
    });
    reconcileState = deps.resolveMachineReconcileState({
      machine,
      desiredImage,
      preferredAccessToken: reconcileState.accessToken,
      desiredEnvSubset: reconcileEnv.desiredEnvSubset,
    });
    if (!deps.hasMachineDrift(reconcileState.needs)) return;
    const driftLabels = deps.getMachineDriftLabels(reconcileState.needs);

    const state = machine.state || "unknown";
    if (state === "started" || state === "starting") {
      result.skippedRunningMachines++;
      return;
    }

    if (!deps.warmOutdatedImages) return;

    if (dryRun) {
      console.log(
        `[FlyMachines] (dry-run) Warm reconciled machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) state=${state} drift=${driftLabels.join(",")}`,
      );
      return;
    }

    try {
      let current = await deps.getMachine(machine.id);
      let currentState = current.state || "unknown";
      let currentStudioId = deps.resolveStudioIdFromMachine(current, studioId);
      let currentReconcileState = deps.resolveMachineReconcileState({
        machine: current,
        desiredImage,
      });
      let currentReconcileEnv = await deps.buildReconciledEnv({
        machine: current,
        organizationId: identity.organizationId,
        projectSlug: identity.projectSlug,
        version: identity.version,
        studioId: currentStudioId,
        accessToken: currentReconcileState.accessToken,
      });
      currentReconcileState = deps.resolveMachineReconcileState({
        machine: current,
        desiredImage,
        preferredAccessToken: currentReconcileState.accessToken,
        desiredEnvSubset: currentReconcileEnv.desiredEnvSubset,
      });

      if (currentState === "destroyed" || currentState === "destroying") return;

      // Suspended machines would resume a snapshot; stop first to boot the new image.
      if (deps.shouldStopSuspendedBeforeReconcile(currentState, currentReconcileState.needs)) {
        await deps.stopMachine(machine.id);
        await deps.waitForState({
          machineId: machine.id,
          state: "stopped",
          timeoutMs: 60_000,
        });
        current = await deps.getMachine(machine.id);
        currentState = current.state || "unknown";
        currentStudioId = deps.resolveStudioIdFromMachine(current, studioId);
        currentReconcileEnv = await deps.buildReconciledEnv({
          machine: current,
          organizationId: identity.organizationId,
          projectSlug: identity.projectSlug,
          version: identity.version,
          studioId: currentStudioId,
          accessToken: currentReconcileState.accessToken,
        });
        currentReconcileState = deps.resolveMachineReconcileState({
          machine: current,
          desiredImage,
          preferredAccessToken: currentReconcileState.accessToken,
          desiredEnvSubset: currentReconcileEnv.desiredEnvSubset,
        });
      }

      if (!deps.hasMachineDrift(currentReconcileState.needs)) return;
      if (current.state !== "stopped") {
        // Unexpected state (e.g. replacing). Skip and retry next cycle.
        return;
      }

      const port = deps.getMachineExternalPort(current);
      if (!port) {
        throw new Error("Missing external port; cannot warm image");
      }
      const accessToken = currentReconcileState.accessToken;
      const reconciledAt = new Date().toISOString();
      const metadata = deps.buildReconciledMetadata({
        machine: current,
        organizationId: identity.organizationId,
        projectSlug: identity.projectSlug,
        version: identity.version,
        port,
        studioId: currentStudioId,
        desiredImage,
        accessToken,
        extra: {
          vivd_last_machine_reconcile_at: reconciledAt,
          ...(currentReconcileState.needs.image
            ? { vivd_last_image_reconcile_at: reconciledAt }
            : {}),
        },
      });

      const config = deps.buildReconciledMachineConfig({
        machine: current,
        port,
        desiredImage,
        accessToken,
        needs: currentReconcileState.needs,
        metadata,
        fullEnv: currentReconcileEnv.fullEnv,
      });

      await deps.updateMachineConfig({
        machineId: machine.id,
        config,
        skipLaunch: true,
      });

      const refreshedAfterConfigUpdate = await deps.getMachine(machine.id);
      const postUpdateDrift = deps.resolveMachineReconcileState({
        machine: refreshedAfterConfigUpdate,
        desiredImage,
        preferredAccessToken: accessToken,
        desiredEnvSubset: currentReconcileEnv.desiredEnvSubset,
      }).needs;
      if (deps.hasMachineDrift(postUpdateDrift) && !hasOnlyImageDrift(postUpdateDrift)) {
        const remainingDriftLabels = deps.getMachineDriftLabels(postUpdateDrift).join(",");
        const configImage =
          typeof refreshedAfterConfigUpdate.config?.image === "string"
            ? refreshedAfterConfigUpdate.config.image
            : null;
        const metadataImage = deps.trimToken(
          deps.getMachineMetadataValue(refreshedAfterConfigUpdate, "vivd_image"),
        );
        console.warn(
          `[FlyMachines] Warm reconcile drift did not clear for ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) after config update (drift=${remainingDriftLabels}) desiredImage=${desiredImage} configImage=${configImage} vivd_image=${metadataImage}`,
        );
      }

      await deps.startMachineHandlingReplacement(machine.id, replacementTimeoutMs);
      const url = deps.getPublicUrlForPort(port);
      await deps.waitForReady({
        machineId: machine.id,
        url,
        timeoutMs: Math.min(deps.startTimeoutMs, 120_000),
      });
      await deps.requestRuntimeCleanup(url, accessToken);
      await sleep(POST_RUNTIME_CLEANUP_DRAIN_MS);

      // Park the machine quickly so the next user start is fast, without leaving it running.
      const parked = await deps.suspendOrStopMachine(machine.id);
      if (parked !== "suspended") {
        throw new Error(
          `[FlyMachines] Warm reconcile parked machine ${machine.id} in state=${parked}; expected suspended`,
        );
      }

      result.warmedOutdatedImages++;
      console.log(
        `[FlyMachines] Warmed reconciled machine ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}) drift=${driftLabels.join(",")}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({
        machineId: machine.id,
        action: "warm_reconciled_machine",
        message,
      });
      console.warn(
        `[FlyMachines] Warm reconciled machine failed for ${machine.id} (${identity.organizationId}:${identity.projectSlug}/v${identity.version}): ${message}`,
      );
    }
  });

  return result;
}
