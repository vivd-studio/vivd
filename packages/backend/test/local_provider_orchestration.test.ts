import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  VIVD_INSTALL_PROFILE: process.env.VIVD_INSTALL_PROFILE,
  CADDY_ADMIN_URL: process.env.CADDY_ADMIN_URL,
  CADDY_PLATFORM_ADMIN_URL: process.env.CADDY_PLATFORM_ADMIN_URL,
};

describe("LocalStudioMachineProvider orchestration", () => {
  beforeEach(() => {
    delete process.env.STUDIO_PUBLIC_HOST;
    delete process.env.STUDIO_PUBLIC_PROTOCOL;
    delete process.env.VIVD_APP_URL;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.CONTROL_PLANE_HOST;
    delete process.env.DOMAIN;
    delete process.env.VIVD_INSTALL_PROFILE;
    delete process.env.CADDY_ADMIN_URL;
    delete process.env.CADDY_PLATFORM_ADMIN_URL;
  });

  afterAll(() => {
    process.env.STUDIO_PUBLIC_HOST = envSnapshot.STUDIO_PUBLIC_HOST;
    process.env.STUDIO_PUBLIC_PROTOCOL = envSnapshot.STUDIO_PUBLIC_PROTOCOL;
    process.env.VIVD_APP_URL = envSnapshot.VIVD_APP_URL;
    process.env.BETTER_AUTH_URL = envSnapshot.BETTER_AUTH_URL;
    process.env.CONTROL_PLANE_HOST = envSnapshot.CONTROL_PLANE_HOST;
    process.env.DOMAIN = envSnapshot.DOMAIN;
    process.env.VIVD_INSTALL_PROFILE = envSnapshot.VIVD_INSTALL_PROFILE;
    process.env.CADDY_ADMIN_URL = envSnapshot.CADDY_ADMIN_URL;
    process.env.CADDY_PLATFORM_ADMIN_URL = envSnapshot.CADDY_PLATFORM_ADMIN_URL;
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
    process.env.VIVD_INSTALL_PROFILE = "platform";

    const provider = new LocalStudioMachineProvider();
    const routeService = (provider as any).routeService;
    vi.spyOn(routeService, "upsertRuntimeRoute").mockResolvedValue("/_studio/site-1-v1");
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
      backendUrl: "http://127.0.0.1:3200",
      runtimeUrl: "http://localhost:3200",
      compatibilityUrl: "/_studio/site-1-v1",
      accessToken: "access-1",
    });

    expect(routeService.upsertRuntimeRoute).toHaveBeenCalledWith({
      routeId: (provider as any).routeIdFor("org-1", "site-1", 1),
      targetBaseUrl: "http://127.0.0.1:3200",
    });

    provider.stopAll();
  });

  it("prefers the configured control-plane host for local studio URLs", async () => {
    process.env.CONTROL_PLANE_HOST = "app.localhost";
    process.env.VIVD_INSTALL_PROFILE = "platform";

    const provider = new LocalStudioMachineProvider();
    const routeService = (provider as any).routeService;
    vi.spyOn(routeService, "upsertRuntimeRoute").mockResolvedValue("/_studio/site-1-v1");
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
      backendUrl: "http://127.0.0.1:3200",
      runtimeUrl: "http://app.localhost:3200",
      compatibilityUrl: "/_studio/site-1-v1",
      accessToken: "access-1",
    });

    expect(routeService.upsertRuntimeRoute).toHaveBeenCalledWith({
      routeId: (provider as any).routeIdFor("org-1", "site-1", 1),
      targetBaseUrl: "http://127.0.0.1:3200",
    });

    provider.stopAll();
  });

  it("returns a relative compatibility route for local studios in solo mode", async () => {
    process.env.VIVD_INSTALL_PROFILE = "solo";

    const provider = new LocalStudioMachineProvider();
    const routeService = (provider as any).routeService;
    vi.spyOn(routeService, "upsertRuntimeRoute").mockResolvedValue("/_studio/site-1-v1");
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
      backendUrl: "http://127.0.0.1:3200",
      runtimeUrl: "http://localhost:3200",
      compatibilityUrl: "/_studio/site-1-v1",
      accessToken: "access-1",
    });

    expect(routeService.upsertRuntimeRoute).toHaveBeenCalledWith({
      routeId: (provider as any).routeIdFor("org-1", "site-1", 1),
      targetBaseUrl: "http://127.0.0.1:3200",
    });

    provider.stopAll();
  });

  it("targets the backend service hostname for local compatibility routes inside the compose stack", async () => {
    process.env.VIVD_INSTALL_PROFILE = "solo";
    process.env.CADDY_PLATFORM_ADMIN_URL = "http://caddy-platform:2019";

    const provider = new LocalStudioMachineProvider();
    const routeService = (provider as any).routeService;
    vi.spyOn(routeService, "upsertRuntimeRoute").mockResolvedValue("/_studio/site-1-v1");
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

    await provider.getUrl("org-1", "site-1", 1);

    expect(routeService.upsertRuntimeRoute).toHaveBeenCalledWith({
      routeId: (provider as any).routeIdFor("org-1", "site-1", 1),
      targetBaseUrl: "http://backend:3200",
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

  it("injects a local vivd wrapper into the spawned studio PATH", async () => {
    const provider = new LocalStudioMachineProvider();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-local-cli-"));
    const cliDir = path.join(tmpDir, "cli");
    await fs.mkdir(path.join(cliDir, "dist"), { recursive: true });
    await fs.mkdir(path.join(cliDir, "src"), { recursive: true });
    await fs.writeFile(path.join(cliDir, "src", "index.ts"), "export {};\n");
    await fs.writeFile(path.join(cliDir, "dist", "index.js"), 'console.log("vivd");\n');

    const env: Record<string, string> = {
      PATH: "/usr/bin:/bin",
    };

    try {
      await (provider as any).ensureCliAvailable(cliDir, env);

      const wrapperPath = path.join(cliDir, "dist", "vivd");
      const wrapper = await fs.readFile(wrapperPath, "utf8");
      expect(wrapper).toContain(`node "${path.join(cliDir, "dist", "index.js")}"`);
      expect(env.PATH?.split(path.delimiter)[0]).toBe(path.join(cliDir, "dist"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
      provider.stopAll();
    }
  });
});
