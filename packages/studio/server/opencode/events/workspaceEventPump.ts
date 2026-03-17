import path from "node:path";
import { canonicalEventBridge } from "./canonicalEventBridge.js";
import { serverManager } from "../serverManager.js";

const TEMPORARY_RETAIN_MS = 60_000;
const STOP_GRACE_MS = 5_000;

type PumpState = {
  retainers: number;
  controller: AbortController;
  stopTimer: NodeJS.Timeout | null;
  startPromise: Promise<void> | null;
  loopPromise: Promise<void> | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
}

class WorkspaceEventPumpManager {
  private pumps = new Map<string, PumpState>();

  async acquire(projectDir: string): Promise<() => void> {
    const workspaceKey = path.resolve(projectDir);
    let state = this.pumps.get(workspaceKey);

    if (!state) {
      state = {
        retainers: 0,
        controller: new AbortController(),
        stopTimer: null,
        startPromise: null,
        loopPromise: null,
      };
      this.pumps.set(workspaceKey, state);
    }

    state.retainers += 1;
    if (state.stopTimer) {
      clearTimeout(state.stopTimer);
      state.stopTimer = null;
    }

    if (!state.startPromise && !state.loopPromise) {
      state.startPromise = this.startLoop(workspaceKey, state);
      await state.startPromise;
    } else if (state.startPromise) {
      await state.startPromise;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(workspaceKey);
    };
  }

  async retainTemporarily(
    projectDir: string,
    ttlMs = TEMPORARY_RETAIN_MS,
  ): Promise<void> {
    const release = await this.acquire(projectDir);
    const timer = setTimeout(() => {
      release();
    }, ttlMs);
    timer.unref?.();
  }

  stop(projectDir: string): void {
    const workspaceKey = path.resolve(projectDir);
    const state = this.pumps.get(workspaceKey);
    if (!state) return;

    if (state.stopTimer) {
      clearTimeout(state.stopTimer);
      state.stopTimer = null;
    }

    state.controller.abort();
    this.pumps.delete(workspaceKey);
    canonicalEventBridge.emitBridgeStatus(workspaceKey, "disconnected");
  }

  private release(workspaceKey: string): void {
    const state = this.pumps.get(workspaceKey);
    if (!state) return;

    state.retainers = Math.max(0, state.retainers - 1);
    if (state.retainers > 0 || state.stopTimer) {
      return;
    }

    state.stopTimer = setTimeout(() => {
      this.stop(workspaceKey);
    }, STOP_GRACE_MS);
    state.stopTimer.unref?.();
  }

  private async startLoop(workspaceKey: string, state: PumpState): Promise<void> {
    state.loopPromise = this.runLoop(workspaceKey, state)
      .catch((error) => {
        if (state.controller.signal.aborted) return;
        canonicalEventBridge.emitBridgeStatus(
          workspaceKey,
          "error",
          toErrorMessage(error, "OpenCode event pump crashed"),
        );
      })
      .finally(() => {
        state.loopPromise = null;
        state.startPromise = null;
        if (this.pumps.get(workspaceKey) === state && state.retainers === 0) {
          this.pumps.delete(workspaceKey);
        }
      });
  }

  private async runLoop(workspaceKey: string, state: PumpState): Promise<void> {
    let reconnectAttempt = 0;

    while (!state.controller.signal.aborted) {
      try {
        const { client } = await serverManager.getClientAndDirectory(workspaceKey);
        canonicalEventBridge.emitBridgeStatus(workspaceKey, "connected");

        const events = await client.event.subscribe(
          {},
          { signal: state.controller.signal } as any,
        );

        reconnectAttempt = 0;
        for await (const event of events.stream) {
          if (state.controller.signal.aborted) break;
          canonicalEventBridge.emitOpencodeEvent(workspaceKey, event);
        }

        if (state.controller.signal.aborted) {
          break;
        }

        reconnectAttempt += 1;
        canonicalEventBridge.emitBridgeStatus(
          workspaceKey,
          "reconnecting",
          "OpenCode event stream ended unexpectedly",
        );
      } catch (error) {
        if (state.controller.signal.aborted) {
          break;
        }

        reconnectAttempt += 1;
        canonicalEventBridge.emitBridgeStatus(
          workspaceKey,
          "reconnecting",
          toErrorMessage(error, "OpenCode event stream failed"),
        );
      }

      const delayMs = Math.min(500 * reconnectAttempt, 5_000);
      await sleep(delayMs);
    }
  }
}

export const workspaceEventPump = new WorkspaceEventPumpManager();
