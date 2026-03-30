import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

const envSnapshot = {
  STUDIO_PUBLIC_HOST: process.env.STUDIO_PUBLIC_HOST,
  STUDIO_PUBLIC_PROTOCOL: process.env.STUDIO_PUBLIC_PROTOCOL,
  VIVD_APP_URL: process.env.VIVD_APP_URL,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  CONTROL_PLANE_HOST: process.env.CONTROL_PLANE_HOST,
  DOMAIN: process.env.DOMAIN,
};

describe("LocalStudioMachineProvider orchestration", () => {
  beforeEach(() => {
    delete process.env.STUDIO_PUBLIC_HOST;
    delete process.env.STUDIO_PUBLIC_PROTOCOL;
    delete process.env.VIVD_APP_URL;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.CONTROL_PLANE_HOST;
    delete process.env.DOMAIN;
  });

  afterAll(() => {
    process.env.STUDIO_PUBLIC_HOST = envSnapshot.STUDIO_PUBLIC_HOST;
    process.env.STUDIO_PUBLIC_PROTOCOL = envSnapshot.STUDIO_PUBLIC_PROTOCOL;
    process.env.VIVD_APP_URL = envSnapshot.VIVD_APP_URL;
    process.env.BETTER_AUTH_URL = envSnapshot.BETTER_AUTH_URL;
    process.env.CONTROL_PLANE_HOST = envSnapshot.CONTROL_PLANE_HOST;
    process.env.DOMAIN = envSnapshot.DOMAIN;
  });

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
      runtimeUrl: "http://localhost:3200",
      compatibilityUrl: null,
      accessToken: "access-1",
    });

    provider.stopAll();
  });

  it("prefers the configured control-plane host for local studio URLs", async () => {
    process.env.CONTROL_PLANE_HOST = "app.localhost";

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
      url: "http://app.localhost:3200",
      runtimeUrl: "http://app.localhost:3200",
      compatibilityUrl: null,
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
