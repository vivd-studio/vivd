import { describe, expect, it, vi, afterEach } from "vitest";
import { startMachineHandlingReplacement } from "../src/services/studioMachines/fly/lifecycle";
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
});
