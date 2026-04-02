import { describe, expect, it, vi } from "vitest";
import { RuntimeQuiesceCoordinator } from "./RuntimeQuiesceCoordinator.js";

describe("RuntimeQuiesceCoordinator", () => {
  it("marks subsystems idle only after quiesce completes", async () => {
    let release!: () => void;
    const quiesceGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const coordinator = new RuntimeQuiesceCoordinator([
      {
        name: "one",
        quiesce: async () => {
          await quiesceGate;
        },
      },
      {
        name: "two",
        quiesce: async () => {},
      },
    ]);

    const quiescePromise = coordinator.quiesceForSuspend({ projectDir: "/tmp/project" });

    expect(coordinator.getQuiesceStatus()).toEqual({
      state: "quiescing",
      subsystems: {
        one: "quiescing",
        two: "quiescing",
      },
      lastQuiescedAt: null,
    });

    release();

    const status = await quiescePromise;
    expect(status.state).toBe("idle");
    expect(status.subsystems).toEqual({
      one: "idle",
      two: "idle",
    });
    expect(status.lastQuiescedAt).toEqual(expect.any(String));
  });

  it("resumes adapters after new activity arrives during quiesce", async () => {
    let release!: () => void;
    const quiesceGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resume = vi.fn();

    const coordinator = new RuntimeQuiesceCoordinator([
      {
        name: "one",
        quiesce: async () => {
          await quiesceGate;
        },
        resume,
      },
    ]);

    const quiescePromise = coordinator.quiesceForSuspend({ projectDir: "/tmp/project" });
    await coordinator.resumeAfterActivity();
    release();
    await quiescePromise;

    expect(resume).toHaveBeenCalledTimes(1);
    expect(coordinator.getQuiesceStatus().state).toBe("active");
    expect(coordinator.getQuiesceStatus().subsystems).toEqual({
      one: "active",
    });
  });

  it("surfaces quiesce failures without claiming the runtime is idle", async () => {
    const coordinator = new RuntimeQuiesceCoordinator([
      {
        name: "one",
        quiesce: async () => {
          throw new Error("stop failed");
        },
      },
    ]);

    await expect(
      coordinator.quiesceForSuspend({ projectDir: "/tmp/project" }),
    ).rejects.toThrow("stop failed");
    expect(coordinator.getQuiesceStatus()).toEqual({
      state: "active",
      subsystems: {
        one: "active",
      },
      lastQuiescedAt: null,
    });
  });
});
