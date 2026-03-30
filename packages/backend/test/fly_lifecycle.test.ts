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

  it("waits for pending and created replacement states to settle before starting", async () => {
    vi.useFakeTimers();

    const getMachine = vi
      .fn<() => Promise<FlyMachine>>()
      .mockResolvedValueOnce(machine("pending"))
      .mockResolvedValueOnce(machine("created"))
      .mockResolvedValueOnce(machine("stopped"));
    const startMachine = vi.fn(async () => {});

    const result = startMachineHandlingReplacement({
      machineId: "machine-1",
      getMachine: async () => getMachine(),
      startMachine,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await result;

    expect(startMachine).toHaveBeenCalledTimes(1);
    expect(getMachine).toHaveBeenCalledTimes(3);
  });
});
