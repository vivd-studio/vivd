import type { FlyMachine, FlyMachineState } from "./types";
import { requestRuntime } from "./runtimeHttp";
import { parsePositiveInt, sleep } from "./utils";

const READY_POLL_INTERVAL_MS = 250;
const TRANSIENT_MACHINE_POLL_BACKOFF_MS = 1_000;
const DEFAULT_SUSPEND_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_SUSPEND_IN_PROGRESS_TIMEOUT_MS = 120_000;

export function resolveSuspendWaitTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return Math.max(
    5_000,
    parsePositiveInt(
      env.VIVD_FLY_SUSPEND_WAIT_TIMEOUT_MS,
      DEFAULT_SUSPEND_WAIT_TIMEOUT_MS,
    ),
  );
}

export function resolveSuspendInProgressTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const waitTimeoutMs = resolveSuspendWaitTimeoutMs(env);
  return Math.max(
    waitTimeoutMs,
    parsePositiveInt(
      env.VIVD_FLY_SUSPEND_IN_PROGRESS_TIMEOUT_MS,
      DEFAULT_SUSPEND_IN_PROGRESS_TIMEOUT_MS,
    ),
  );
}

function isFlyRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("resource_exhausted") ||
    normalized.includes("rate limit exceeded") ||
    normalized.includes("429")
  );
}

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
    let machine: FlyMachine;
    try {
      machine = await options.getMachine(options.machineId);
    } catch (error) {
      if (!isFlyRateLimitError(error)) {
        throw error;
      }
      await sleep(TRANSIENT_MACHINE_POLL_BACKOFF_MS);
      continue;
    }
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
    let machine: FlyMachine;
    try {
      machine = await options.getMachine(options.machineId);
    } catch (error) {
      if (!isFlyRateLimitError(error)) {
        throw error;
      }
      await sleep(TRANSIENT_MACHINE_POLL_BACKOFF_MS);
      continue;
    }
    const state = machine.state || "unknown";

    if (state === "destroyed" || state === "destroying") {
      throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
    }

    if (state === "started") {
      try {
        const response = await requestRuntime({
          url: `${options.url}/health`,
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          timeoutMs: 3_000,
        });
        if (response.status >= 200 && response.status < 300) {
          const data = JSON.parse(response.body || "{}") as { status?: string };
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
  let lastState: string | null = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    let machine: FlyMachine;
    try {
      machine = await options.getMachine(options.machineId);
    } catch (error) {
      if (!isFlyRateLimitError(error)) {
        throw error;
      }
      await sleep(TRANSIENT_MACHINE_POLL_BACKOFF_MS);
      continue;
    }
    const state = machine.state || "unknown";
    lastState = state;

    if (state === options.state) return;
    if (state === "destroyed" || state === "destroying") {
      throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
    }

    await sleep(500);
  }

  throw new Error(
    `[FlyMachines] Timed out waiting for machine to reach state=${options.state} (${options.machineId}; lastState=${lastState || "unknown"})`,
  );
}

async function getCurrentMachineState(options: {
  machineId: string;
  getMachine: (machineId: string) => Promise<FlyMachine>;
}): Promise<string | null> {
  try {
    const machine = await options.getMachine(options.machineId);
    const state = machine.state || "unknown";
    if (state === "destroyed" || state === "destroying") {
      throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
    }
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("was destroyed")) {
      throw error;
    }
    return null;
  }
}

function appendLastState(message: string, state: string | null): string {
  if (!state) return message;
  if (message.includes(`lastState=${state}`)) return message;
  return `${message}; lastState=${state}`;
}

async function waitForSuspendingMachineToSettle(options: {
  machineId: string;
  suspendInProgressTimeoutMs: number;
  getMachine: (machineId: string) => Promise<FlyMachine>;
  waitForState: (options: {
    machineId: string;
    state: FlyMachineState;
    timeoutMs: number;
  }) => Promise<void>;
}): Promise<boolean> {
  const currentState = await getCurrentMachineState(options);
  if (currentState === "suspended") return true;
  if (currentState !== "suspending") return false;

  await options.waitForState({
    machineId: options.machineId,
    state: "suspended",
    timeoutMs: options.suspendInProgressTimeoutMs,
  });
  return true;
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
  const suspendWaitTimeoutMs = resolveSuspendWaitTimeoutMs();
  const suspendInProgressTimeoutMs = resolveSuspendInProgressTimeoutMs();
  const initial = await options.getMachine(options.machineId);
  const initialState = initial.state || "unknown";
  if (initialState === "suspended") return "suspended";
  if (initialState === "stopped") return "stopped";
  if (initialState === "destroyed" || initialState === "destroying") {
    throw new Error(`[FlyMachines] Machine ${options.machineId} was destroyed`);
  }
  if (initialState === "suspending") {
    await options.waitForState({
      machineId: options.machineId,
      state: "suspended",
      timeoutMs: suspendInProgressTimeoutMs,
    });
    return "suspended";
  }

  const attempts = 3;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await options.suspendMachine(options.machineId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;

      if (message.includes("was destroyed")) throw err;

      try {
        const settled = await waitForSuspendingMachineToSettle({
          ...options,
          suspendInProgressTimeoutMs,
        });
        if (settled) {
          return "suspended";
        }
        const currentState = await getCurrentMachineState(options);
        lastError = appendLastState(message, currentState);
      } catch (settleError) {
        const settleMessage =
          settleError instanceof Error ? settleError.message : String(settleError);
        if (settleMessage.includes("was destroyed")) throw settleError;
        lastError = settleMessage;
      }

      if (attempt < attempts) {
        await sleep(Math.min(5000, 750 * attempt));
        continue;
      }
      break;
    }

    try {
      await options.waitForState({
        machineId: options.machineId,
        state: "suspended",
        timeoutMs: suspendWaitTimeoutMs,
      });
      return "suspended";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;

      if (message.includes("was destroyed")) throw err;

      try {
        const settled = await waitForSuspendingMachineToSettle({
          ...options,
          suspendInProgressTimeoutMs,
        });
        if (settled) {
          return "suspended";
        }
        const currentState = await getCurrentMachineState(options);
        lastError = appendLastState(message, currentState);
      } catch (settleError) {
        const settleMessage =
          settleError instanceof Error ? settleError.message : String(settleError);
        if (settleMessage.includes("was destroyed")) throw settleError;
        lastError = settleMessage;
      }

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
