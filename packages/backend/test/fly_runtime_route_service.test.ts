import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reloadCaddyConfigMock } = vi.hoisted(() => ({
  reloadCaddyConfigMock: vi.fn(async () => {}),
}));

vi.mock("../src/services/system/CaddyAdminService", () => ({
  reloadCaddyConfig: reloadCaddyConfigMock,
}));

import { FlyRuntimeRouteService } from "../src/services/studioMachines/fly/runtimeRouteService";

describe("FlyRuntimeRouteService", () => {
  let routesDir: string;

  beforeEach(() => {
    routesDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-fly-routes-"));
    reloadCaddyConfigMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(routesDir, { recursive: true, force: true });
  });

  it("writes a Caddy route that proxies tenant-host traffic to the Fly machine origin", async () => {
    const service = new FlyRuntimeRouteService({
      getRoutesDir: () => routesDir,
      getRoutePath: () => "/_studio/runtime-1",
    });

    const routePath = await service.upsertRuntimeRoute({
      routeId: "runtime-1",
      targetBaseUrl: "https://vivd-studio-prod.fly.dev:3115",
    });

    expect(routePath).toBe("/_studio/runtime-1");
    expect(reloadCaddyConfigMock).toHaveBeenCalledTimes(1);

    const content = fs.readFileSync(
      path.join(routesDir, "studio-runtime-1.caddy"),
      "utf-8",
    );
    expect(content).toContain("@vivd_studio_runtime_1 path /_studio/runtime-1 /_studio/runtime-1/*");
    expect(content).toContain("uri strip_prefix /_studio/runtime-1");
    expect(content).toContain(
      "reverse_proxy https://vivd-studio-prod.fly.dev:3115",
    );
    expect(content).not.toContain("header_up Host");
    expect(content).toContain(
      "header_up X-Forwarded-Prefix /_studio/runtime-1",
    );
    expect(content).toContain(
      "header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}",
    );
    expect(content).toContain(
      "header_up X-Forwarded-Port {http.request.header.X-Forwarded-Port}",
    );
    expect(content).toContain("tls_server_name vivd-studio-prod.fly.dev");
  });

  it("removes a generated route file", async () => {
    const service = new FlyRuntimeRouteService({
      getRoutesDir: () => routesDir,
      getRoutePath: () => "/_studio/runtime-2",
    });

    await service.upsertRuntimeRoute({
      routeId: "runtime-2",
      targetBaseUrl: "https://vivd-studio-prod.fly.dev:3116",
    });
    reloadCaddyConfigMock.mockClear();

    await service.removeRuntimeRoute("runtime-2");

    expect(
      fs.existsSync(path.join(routesDir, "studio-runtime-2.caddy")),
    ).toBe(false);
    expect(reloadCaddyConfigMock).toHaveBeenCalledTimes(1);
  });
});
