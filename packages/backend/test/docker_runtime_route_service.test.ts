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

import { DockerRuntimeRouteService } from "../src/services/studioMachines/docker/runtimeRouteService";

describe("DockerRuntimeRouteService", () => {
  let routesDir: string;

  beforeEach(() => {
    routesDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-docker-routes-"));
    reloadCaddyConfigMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(routesDir, { recursive: true, force: true });
  });

  it("preserves forwarded proto and port through the runtime compatibility route", async () => {
    const service = new DockerRuntimeRouteService({
      getRoutesDir: () => routesDir,
      getRoutePath: () => "/_studio/runtime-1",
    });

    const routePath = await service.upsertRuntimeRoute({
      routeId: "runtime-1",
      containerName: "studio-runtime-1",
      targetPort: 3100,
    });

    expect(routePath).toBe("/_studio/runtime-1");

    const content = fs.readFileSync(
      path.join(routesDir, "studio-runtime-1.caddy"),
      "utf-8",
    );
    expect(content).toContain(
      "header_up X-Forwarded-Prefix /_studio/runtime-1",
    );
    expect(content).toContain(
      "header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}",
    );
    expect(content).toContain(
      "header_up X-Forwarded-Port {http.request.header.X-Forwarded-Port}",
    );
  });

  it("uses resolved public proto and port when the deployment has a fixed public origin", async () => {
    const service = new DockerRuntimeRouteService({
      getRoutesDir: () => routesDir,
      getRoutePath: () => "/_studio/runtime-1",
      getForwardedProto: () => "https",
      getForwardedPort: () => "443",
    });

    await service.upsertRuntimeRoute({
      routeId: "runtime-1",
      containerName: "studio-runtime-1",
      targetPort: 3100,
    });

    const content = fs.readFileSync(
      path.join(routesDir, "studio-runtime-1.caddy"),
      "utf-8",
    );
    expect(content).toContain("header_up X-Forwarded-Proto https");
    expect(content).toContain("header_up X-Forwarded-Port 443");
    expect(content).not.toContain(
      "header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}",
    );
    expect(content).not.toContain(
      "header_up X-Forwarded-Port {http.request.header.X-Forwarded-Port}",
    );
  });
});
