import type { MachineReconcileNeeds } from "./machineModel";
import type { FlyMachine, FlyMachineState } from "./types";
import { sleep } from "./utils";

export function isMachineGettingReplacedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed_precondition") &&
    normalized.includes("machine getting replaced")
  );
}

export async function startMachineHandlingReplacement(options: {
  machineId: string;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  startMachine: (machineId: string) => Promise<void>;
}): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 60_000;
  let delayMs = 750;

  while (Date.now() - startedAt < timeoutMs) {
    const machine = await options.getMachine(options.machineId);
    const state = machine.state || "unknown";

    if (state === "destroyed" || state === "destroying") {
      throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
    }

    if (state === "started" || state === "starting") return;

    if (state !== "replacing") {
      try {
        await options.startMachine(options.machineId);
        return;
      } catch (err) {
        if (!isMachineGettingReplacedError(err)) throw err;
        // Fall through to retry loop (state should eventually stop being "replacing").
      }
    }

    await sleep(delayMs);
    delayMs = Math.min(5000, Math.round(delayMs * 1.4));
  }

  throw new Error(
    `[FlyMachines] Timed out waiting for machine to finish replacement (${options.machineId})`,
  );
}

export async function waitForReady(options: {
  machineId: string;
  url: string;
  timeoutMs: number;
  getMachine: (machineId: string) => Promise<FlyMachine>;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const machine = await options.getMachine(options.machineId);
    const state = machine.state || "unknown";

    if (state === "destroyed" || state === "destroying") {
      throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
    }

    if (state === "started") {
      try {
        const response = await fetch(`${options.url}/health`, { method: "GET" });
        if (response.ok) {
          const data = (await response.json()) as { status?: string };
          if (data.status === "ok") return;
        }
      } catch {
        // Not ready yet
      }
    }

    await sleep(1000);
  }

  throw new Error(
    `[FlyMachines] Timed out waiting for machine to become ready (${options.machineId})`,
  );
}

export async function waitForState(options: {
  machineId: string;
  state: FlyMachineState;
  timeoutMs: number;
  getMachine: (machineId: string) => Promise<FlyMachine>;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const machine = await options.getMachine(options.machineId);
    const state = machine.state || "unknown";

    if (state === options.state) return;
    if (state === "destroyed" || state === "destroying") {
      throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
    }

    await sleep(500);
  }

  throw new Error(
    `[FlyMachines] Timed out waiting for machine to reach state=${options.state} (${options.machineId})`,
  );
}

export async function suspendOrStopMachine(options: {
  machineId: string;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  suspendMachine: (machineId: string) => Promise<void>;
  stopMachine: (machineId: string) => Promise<void>;
  waitForState: (options: {
    machineId: string;
    state: FlyMachineState;
    timeoutMs: number;
  }) => Promise<void>;
}): Promise<"suspended" | "stopped"> {
  const initial = await options.getMachine(options.machineId);
  const initialState = initial.state || "unknown";
  if (initialState === "suspended") return "suspended";
  if (initialState === "stopped") return "stopped";
  if (initialState === "destroyed" || initialState === "destroying") {
    throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
  }

  const attempts = 3;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await options.suspendMachine(options.machineId);
      await options.waitForState({
        machineId: options.machineId,
        state: "suspended",
        timeoutMs: 30_000,
      });
      return "suspended";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;

      if (message.includes("was destroyed")) throw err;
      if (attempt < attempts) {
        await sleep(Math.min(5000, 750 * attempt));
        continue;
      }
    }
  }

  console.warn(
    `[FlyMachines] Failed to suspend machine ${options.machineId}: ${lastError || "unknown error"}; falling back to stop.`,
  );
  try {
    await options.stopMachine(options.machineId);
    await options.waitForState({
      machineId: options.machineId,
      state: "stopped",
      timeoutMs: 60_000,
    });
  } catch {
    // best-effort
  }
  return "stopped";
}

export async function waitForReconcileDriftToClear(options: {
  machineId: string;
  desiredImage: string;
  timeoutMs: number;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  resolveMachineReconcileState: (options: {
    machine: FlyMachine;
    desiredImage: string;
    preferredAccessToken?: string | null;
  }) => { accessToken: string; needs: MachineReconcileNeeds };
  hasMachineDrift: (needs: MachineReconcileNeeds) => boolean;
}): Promise<MachineReconcileNeeds | null> {
  const startedAt = Date.now();
  let lastNeeds: MachineReconcileNeeds | null = null;

  while (Date.now() - startedAt < options.timeoutMs) {
    const machine = await options.getMachine(options.machineId);
    const state = machine.state || "unknown";
    if (state === "destroyed" || state === "destroying") {
      throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
    }

    const reconcileState = options.resolveMachineReconcileState({
      machine,
      desiredImage: options.desiredImage,
    });
    lastNeeds = reconcileState.needs;

    if (!options.hasMachineDrift(lastNeeds)) return null;
    await sleep(500);
  }

  return lastNeeds;
}
