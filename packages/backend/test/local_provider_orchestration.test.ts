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
      accessToken: "access-1",
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

  it("returns the local studio access token from getUrl", async () => {
    const provider = new LocalStudioMachineProvider();
    (provider as any).studios.set("org-1:site-1:v1", {
      process: {} as any,
      port: 3200,
      studioId: "studio-1",
      accessToken: "access-1",
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
      lastActivityAt: new Date(),
      objectStorageSync: null,
    });

    await expect(provider.getUrl("org-1", "site-1", 1)).resolves.toEqual({
      studioId: "studio-1",
      url: "http://localhost:3200",
      accessToken: "access-1",
    });

    provider.stopAll();
  });

  it("resolves runtime auth for local studios", async () => {
    const provider = new LocalStudioMachineProvider();
    (provider as any).studios.set("org-1:site-1:v1", {
      process: {} as any,
      port: 3200,
      studioId: "studio-1",
      accessToken: "access-1",
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
      lastActivityAt: new Date(),
      objectStorageSync: null,
    });

    await expect(provider.resolveRuntimeAuth("studio-1", "access-1")).resolves.toEqual({
      studioId: "studio-1",
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
    });
    await expect(provider.resolveRuntimeAuth("studio-1", "wrong")).resolves.toBeNull();

    provider.stopAll();
  });
});
