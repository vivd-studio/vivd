import { describe, expect, it, vi, afterEach } from "vitest";
import {
  startMachineHandlingReplacement,
  waitForReady,
} from "../src/services/studioMachines/fly/lifecycle";
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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "starting" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok" }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = waitForReady({
      machineId: "machine-1",
      url: "http://example.test",
      timeoutMs: 5_000,
      getMachine: async () => getMachine(),
    });

    await vi.advanceTimersByTimeAsync(300);
    await result;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getMachine).toHaveBeenCalledTimes(2);
  });
});
