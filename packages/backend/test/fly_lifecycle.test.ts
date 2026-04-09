import { describe, expect, it, vi, afterEach } from "vitest";
import {
  resolveSuspendInProgressTimeoutMs,
  resolveSuspendWaitTimeoutMs,
  startMachineHandlingReplacement,
  suspendOrStopMachine,
  waitForReady,
  waitForState,
} from "../src/services/studioMachines/fly/lifecycle";
import * as runtimeHttp from "../src/services/studioMachines/fly/runtimeHttp";
import type { FlyMachine } from "../src/services/studioMachines/fly/types";

function machine(state: FlyMachine["state"]): FlyMachine {
  return {
    id: "machine-1",
    state: state || undefined,
    config: {},
  };
}

describe("Fly lifecycle helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries start while Fly reports replacement transition states", async () => {
    vi.useFakeTimers();

    const getMachine = vi
      .fn<() => Promise<FlyMachine>>()
      .mockResolvedValueOnce(machine("pending"))
      .mockResolvedValueOnce(machine("created"))
      .mockResolvedValueOnce(machine("stopped"));
    const startMachine = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("[FlyMachines] failed_precondition: machine getting replaced"),
      )
      .mockRejectedValueOnce(
        new Error("[FlyMachines] failed_precondition: machine still attempting to start"),
      )
      .mockResolvedValueOnce();

    const result = startMachineHandlingReplacement({
      machineId: "machine-1",
      getMachine: async () => getMachine(),
      startMachine,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await result;

    expect(startMachine).toHaveBeenCalledTimes(3);
    expect(getMachine).toHaveBeenCalledTimes(3);
  });

  it("retries while the machine is suspending", async () => {
    vi.useFakeTimers();

    const getMachine = vi
      .fn<() => Promise<FlyMachine>>()
      .mockResolvedValueOnce(machine("suspending"))
      .mockResolvedValueOnce(machine("suspended"));
    const startMachine = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("[FlyMachines] failed_precondition: machine still active, refusing to start"),
      )
      .mockResolvedValueOnce();

    const result = startMachineHandlingReplacement({
      machineId: "machine-1",
      getMachine: async () => getMachine(),
      startMachine,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await result;

    expect(startMachine).toHaveBeenCalledTimes(2);
    expect(getMachine).toHaveBeenCalledTimes(2);
  });

  it("honors an explicit replacement timeout override", async () => {
    vi.useFakeTimers();

    const getMachine = vi
      .fn<() => Promise<FlyMachine>>()
      .mockResolvedValue(machine("replacing"));
    const startMachine = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(
        new Error("[FlyMachines] failed_precondition: machine getting replaced"),
      );

    const result = startMachineHandlingReplacement({
      machineId: "machine-1",
      getMachine: async () => getMachine(),
      startMachine,
      timeoutMs: 120_000,
    });
    const rejection = expect(result).rejects.toThrow(
      "[FlyMachines] Timed out waiting for machine to finish replacement",
    );

    await vi.advanceTimersByTimeAsync(70_000);
    await Promise.resolve();
    expect(getMachine).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
  });

  it("retries when Fly reports the machine is still active", async () => {
    vi.useFakeTimers();

    const getMachine = vi
      .fn<() => Promise<FlyMachine>>()
      .mockResolvedValueOnce(machine("stopped"))
      .mockResolvedValueOnce(machine("stopped"));
    const startMachine = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("[FlyMachines] failed_precondition: machine still active, refusing to start"),
      )
      .mockResolvedValueOnce();

    const result = startMachineHandlingReplacement({
      machineId: "machine-1",
      getMachine: async () => getMachine(),
      startMachine,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await result;

    expect(startMachine).toHaveBeenCalledTimes(2);
    expect(getMachine).toHaveBeenCalledTimes(2);
  });

  it("polls readiness frequently enough to avoid adding nearly a second of wake latency", async () => {
    vi.useFakeTimers();

    const getMachine = vi.fn<() => Promise<FlyMachine>>().mockResolvedValue(machine("started"));
    const requestRuntimeMock = vi
      .spyOn(runtimeHttp, "requestRuntime")
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({ status: "starting" }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({ status: "ok" }),
      });

    const result = waitForReady({
      machineId: "machine-1",
      url: "http://example.test",
      timeoutMs: 5_000,
      getMachine: async () => getMachine(),
    });

    await vi.advanceTimersByTimeAsync(300);
    await result;

    expect(requestRuntimeMock).toHaveBeenCalledTimes(2);
    expect(getMachine).toHaveBeenCalledTimes(2);
  });

  it("waitForReady backs off and continues when Fly rate limits machine polling", async () => {
    vi.useFakeTimers();

    const getMachine = vi
      .fn<() => Promise<FlyMachine>>()
      .mockRejectedValueOnce(
        new Error("[FlyMachines] resource_exhausted: rate limit exceeded"),
      )
      .mockResolvedValueOnce(machine("started"));
    const requestRuntimeMock = vi.spyOn(runtimeHttp, "requestRuntime").mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ status: "ok" }),
    });

    const result = waitForReady({
      machineId: "machine-1",
      url: "http://example.test",
      timeoutMs: 5_000,
      getMachine: async () => getMachine(),
    });

    await vi.advanceTimersByTimeAsync(1_500);
    await result;

    expect(getMachine).toHaveBeenCalledTimes(2);
    expect(requestRuntimeMock).toHaveBeenCalledTimes(1);
  });

  it("waitForState backs off and continues when Fly rate limits machine polling", async () => {
    vi.useFakeTimers();

    const getMachine = vi
      .fn<() => Promise<FlyMachine>>()
      .mockRejectedValueOnce(
        new Error("[FlyMachines] resource_exhausted: rate limit exceeded"),
      )
      .mockResolvedValueOnce(machine("suspended"));

    const result = waitForState({
      machineId: "machine-1",
      state: "suspended",
      timeoutMs: 5_000,
      getMachine: async () => getMachine(),
    });

    await vi.advanceTimersByTimeAsync(1_500);
    await result;

    expect(getMachine).toHaveBeenCalledTimes(2);
  });

  it("waitForState reports the last observed state on timeout", async () => {
    vi.useFakeTimers();

    const getMachine = vi.fn<() => Promise<FlyMachine>>().mockResolvedValue(machine("suspending"));

    const result = waitForState({
      machineId: "machine-1",
      state: "suspended",
      timeoutMs: 5_000,
      getMachine: async () => getMachine(),
    });
    const rejection = expect(result).rejects.toThrow("lastState=suspending");

    await vi.advanceTimersByTimeAsync(6_000);
    await rejection;
  });

  it("waits for an already suspending machine instead of reissuing suspend", async () => {
    const getMachine = vi.fn<() => Promise<FlyMachine>>().mockResolvedValue(machine("suspending"));
    const suspendMachine = vi.fn<() => Promise<void>>();
    const stopMachine = vi.fn<() => Promise<void>>();
    const waitForStateMock = vi.fn<
      (options: { machineId: string; state: FlyMachine["state"]; timeoutMs: number }) => Promise<void>
    >().mockResolvedValue(undefined);

    const result = await suspendOrStopMachine({
      machineId: "machine-1",
      getMachine: async () => getMachine(),
      suspendMachine: async () => suspendMachine(),
      stopMachine: async () => stopMachine(),
      waitForState: async (options) => waitForStateMock(options),
    });

    expect(result).toBe("suspended");
    expect(suspendMachine).not.toHaveBeenCalled();
    expect(stopMachine).not.toHaveBeenCalled();
    expect(waitForStateMock).toHaveBeenCalledTimes(1);
    expect(waitForStateMock).toHaveBeenCalledWith({
      machineId: "machine-1",
      state: "suspended",
      timeoutMs: 120_000,
    });
  });

  it("keeps waiting when Fly is already suspending after the first suspend request", async () => {
    const getMachine = vi
      .fn<() => Promise<FlyMachine>>()
      .mockResolvedValueOnce(machine("started"))
      .mockResolvedValueOnce(machine("suspending"));
    const suspendMachine = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const stopMachine = vi.fn<() => Promise<void>>();
    const waitForStateMock = vi
      .fn<
        (options: { machineId: string; state: FlyMachine["state"]; timeoutMs: number }) => Promise<void>
      >()
      .mockRejectedValueOnce(
        new Error(
          "[FlyMachines] Timed out waiting for machine to reach state=suspended (machine-1; lastState=suspending)",
        ),
      )
      .mockResolvedValueOnce(undefined);

    const result = await suspendOrStopMachine({
      machineId: "machine-1",
      getMachine: async () => getMachine(),
      suspendMachine: async () => suspendMachine(),
      stopMachine: async () => stopMachine(),
      waitForState: async (options) => waitForStateMock(options),
    });

    expect(result).toBe("suspended");
    expect(suspendMachine).toHaveBeenCalledTimes(1);
    expect(stopMachine).not.toHaveBeenCalled();
    expect(waitForStateMock).toHaveBeenCalledTimes(2);
    expect(waitForStateMock).toHaveBeenNthCalledWith(1, {
      machineId: "machine-1",
      state: "suspended",
      timeoutMs: 30_000,
    });
    expect(waitForStateMock).toHaveBeenNthCalledWith(2, {
      machineId: "machine-1",
      state: "suspended",
      timeoutMs: 120_000,
    });
  });

  it("honors env overrides for suspend wait timeouts", async () => {
    vi.stubEnv("VIVD_FLY_SUSPEND_WAIT_TIMEOUT_MS", "90000");
    vi.stubEnv("VIVD_FLY_SUSPEND_IN_PROGRESS_TIMEOUT_MS", "180000");

    expect(resolveSuspendWaitTimeoutMs()).toBe(90_000);
    expect(resolveSuspendInProgressTimeoutMs()).toBe(180_000);

    const getMachine = vi.fn<() => Promise<FlyMachine>>().mockResolvedValue(machine("suspending"));
    const suspendMachine = vi.fn<() => Promise<void>>();
    const stopMachine = vi.fn<() => Promise<void>>();
    const waitForStateMock = vi.fn<
      (options: { machineId: string; state: FlyMachine["state"]; timeoutMs: number }) => Promise<void>
    >().mockResolvedValue(undefined);

    const result = await suspendOrStopMachine({
      machineId: "machine-1",
      getMachine: async () => getMachine(),
      suspendMachine: async () => suspendMachine(),
      stopMachine: async () => stopMachine(),
      waitForState: async (options) => waitForStateMock(options),
    });

    expect(result).toBe("suspended");
    expect(waitForStateMock).toHaveBeenCalledWith({
      machineId: "machine-1",
      state: "suspended",
      timeoutMs: 180_000,
    });
  });
});
