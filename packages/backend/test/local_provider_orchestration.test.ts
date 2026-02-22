import { describe, expect, it } from "vitest";
import { LocalStudioMachineProvider } from "../src/services/studioMachines/local";
import type {
  StudioMachineStartArgs,
  StudioMachineStartResult,
} from "../src/services/studioMachines/types";

const args: StudioMachineStartArgs = {
  organizationId: "org-1",
  projectSlug: "site-1",
  version: 1,
  env: {},
};

describe("LocalStudioMachineProvider orchestration", () => {
  it("deduplicates concurrent ensureRunning calls for the same studio key", async () => {
    const provider = new LocalStudioMachineProvider();
    const result: StudioMachineStartResult = {
      studioId: "studio-1",
      url: "http://localhost:3200",
      port: 3200,
    };

    let calls = 0;
    (provider as any).ensureRunningInner = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return result;
    };

    const [first, second] = await Promise.all([
      provider.ensureRunning(args),
      provider.ensureRunning(args),
    ]);

    expect(calls).toBe(1);
    expect(first).toEqual(result);
    expect(second).toEqual(result);
    provider.stopAll();
  });
});

