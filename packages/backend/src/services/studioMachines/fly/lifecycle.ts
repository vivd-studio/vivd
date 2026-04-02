import type { FlyMachine, FlyMachineState } from "./types";
import { sleep } from "./utils";

const READY_POLL_INTERVAL_MS = 250;

export function isMachineGettingReplacedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed_precondition") &&
    normalized.includes("machine getting replaced")
  );
}

function isMachineTemporarilyBusyError(error: unknown): boolean {
  if (isMachineGettingReplacedError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed_precondition") &&
    (normalized.includes("machine still active") ||
      normalized.includes("machine still attempting to start"))
  );
}

export async function startMachineHandlingReplacement(options: {
  machineId: string;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  startMachine: (machineId: string) => Promise<void>;
  timeoutMs?: number;
}): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 60_000;
  let delayMs = 750;
  let lastState: string | null = null;
  let lastError: string | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const machine = await options.getMachine(options.machineId);
    const state = machine.state || "unknown";
    lastState = state;

    if (state === "destroyed" || state === "destroying") {
      throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
    }

    if (state === "started" || state === "starting") return;

    try {
      await options.startMachine(options.machineId);
      return;
    } catch (err) {
      if (!isMachineTemporarilyBusyError(err)) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      // Fall through to retry loop while the machine settles into a startable state.
    }

    await sleep(delayMs);
    delayMs = Math.min(5000, Math.round(delayMs * 1.4));
  }

  throw new Error(
    `[FlyMachines] Timed out waiting for machine to finish replacement (${options.machineId}; lastState=${lastState || "unknown"}${lastError ? `; lastError=${lastError}` : ""})`,
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

    await sleep(READY_POLL_INTERVAL_MS);
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
