import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStudioEnvWorkflow,
  ensureContainerRunningWorkflow,
  waitForReadyWorkflow,
} from "../src/services/studioMachines/docker/runtimeWorkflow";

describe("docker runtime workflow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects the internal backend callback URL when Docker studio env lacks one", () => {
    const env = buildStudioEnvWorkflow(
      {
        desiredKillTimeoutSeconds: 180,
        internalMainBackendUrl: "http://backend:3000/vivd-studio",
      },
      {
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        env: {},
        studioId: "studio-1",
        accessToken: "access-token-1",
      },
    );

    expect(env.MAIN_BACKEND_URL).toBe("http://backend:3000/vivd-studio");
  });

  it("prefers the direct container health URL over the internal proxy route", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForReadyWorkflow(
        {
          inspectContainer: vi.fn().mockResolvedValue({
            Id: "container-1",
            Name: "/studio-site-1-v1-a3f6fad7ba",
            State: {
              Status: "running",
            },
          }),
          getInternalProxyUrlForRoutePath: vi
            .fn()
            .mockReturnValue("http://caddy/_studio/site-1-v1"),
          getContainerLogs: vi.fn().mockResolvedValue(""),
        },
        {
          containerId: "container-1",
          routePath: "/_studio/site-1-v1",
          timeoutMs: 1_000,
        },
      ),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://studio-site-1-v1-a3f6fad7ba:3100/health",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        redirect: "manual",
      }),
    );
  });

  it("includes recent container logs when the studio container exits during startup", async () => {
    const inspectContainer = vi.fn().mockResolvedValue({
      Id: "container-2",
      Name: "/studio-site-1-v1-a3f6fad7ba",
      Config: {
        Image: "vivd-studio:local",
      },
      State: {
        Status: "exited",
        ExitCode: 1,
      },
    });
    const getContainerLogs = vi.fn().mockResolvedValue(`
Starting studio...
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/node_modules/@vivd/installed-plugins/src/index.ts'
`);

    await expect(
      waitForReadyWorkflow(
        {
          inspectContainer,
          getInternalProxyUrlForRoutePath: vi
            .fn()
            .mockReturnValue("http://caddy/_studio/site-1-v1"),
          getContainerLogs,
        },
        {
          containerId: "container-2",
          routePath: "/_studio/site-1-v1",
          timeoutMs: 1_000,
        },
      ),
    ).rejects.toThrow(
      /ERR_MODULE_NOT_FOUND[\s\S]*@vivd\/installed-plugins\/src\/index\.ts/,
    );
    await expect(
      waitForReadyWorkflow(
        {
          inspectContainer,
          getInternalProxyUrlForRoutePath: vi
            .fn()
            .mockReturnValue("http://caddy/_studio/site-1-v1"),
          getContainerLogs,
        },
        {
          containerId: "container-2",
          routePath: "/_studio/site-1-v1",
          timeoutMs: 1_000,
        },
      ),
    ).rejects.toThrow(/exitCode=1/);
  });

  it("includes recent container logs when readiness times out", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(
      new Error("connection refused"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForReadyWorkflow(
        {
          inspectContainer: vi.fn().mockResolvedValue({
            Id: "container-3",
            Name: "/studio-site-1-v1-a3f6fad7ba",
            Config: {
              Image: "vivd-studio:local",
            },
            State: {
              Status: "running",
            },
          }),
          getInternalProxyUrlForRoutePath: vi
            .fn()
            .mockReturnValue("http://caddy/_studio/site-1-v1"),
          getContainerLogs: vi.fn().mockResolvedValue(`
Hydrating source from S3...
Starting studio...
node:internal/modules/esm/resolve:275
`),
        },
        {
          containerId: "container-3",
          routePath: "/_studio/site-1-v1",
          timeoutMs: 5,
        },
      ),
    ).rejects.toThrow(/Recent container logs:[\s\S]*Starting studio/);
  });

  it("returns a direct backend URL for Docker-managed studio runtimes", async () => {
    const result = await ensureContainerRunningWorkflow(
      {
        key: () => "org-1:site-1:v1",
        routeIdFor: () => "site-1-v1",
        containerNameFor: () => "studio-site-1-v1-a3f6fad7ba",
        upsertRuntimeRoute: vi.fn().mockResolvedValue("/_studio/site-1-v1"),
        startContainer: vi.fn().mockResolvedValue(undefined),
        recreateContainer: vi.fn(),
        getDesiredImageStateForRef: vi.fn(),
        getPublicUrlForPort: vi.fn().mockReturnValue("https://studio.example:4100"),
        getPublicUrlForRoutePath: vi
          .fn()
          .mockReturnValue("https://app.example/_studio/site-1-v1"),
        getInternalProxyUrlForRoutePath: vi
          .fn()
          .mockReturnValue("http://caddy/_studio/site-1-v1"),
        startTimeoutMs: 60_000,
        touchKey: vi.fn(),
        waitForReady: vi.fn().mockResolvedValue(undefined),
      },
      {
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        env: {},
      },
      {
        Id: "container-1",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Env: [
            "STUDIO_ID=studio-1",
          ],
          Labels: {
            vivd_studio_id: "studio-1",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "running",
        },
        HostConfig: {
          PortBindings: {
            "3100/tcp": [{ HostPort: "4100" }],
          },
        },
      } as any,
      "access-token-1",
      "ghcr.io/vivd-studio/vivd-studio:latest",
    );

    expect(result).toMatchObject({
      studioId: "studio-1",
      url: "https://studio.example:4100",
      backendUrl: "http://studio-site-1-v1-a3f6fad7ba:3100",
      runtimeUrl: "https://studio.example:4100",
      compatibilityUrl: "https://app.example/_studio/site-1-v1",
      accessToken: "access-token-1",
    });
  });

  it("marks activity before waiting for a stopped container to become ready", async () => {
    const callOrder: string[] = [];

    await expect(
      ensureContainerRunningWorkflow(
        {
          key: () => "org-1:site-1:v1",
          routeIdFor: () => "site-1-v1",
          containerNameFor: () => "studio-site-1-v1-a3f6fad7ba",
          upsertRuntimeRoute: vi.fn().mockResolvedValue("/_studio/site-1-v1"),
          startContainer: vi.fn().mockImplementation(async () => {
            callOrder.push("start");
          }),
          recreateContainer: vi.fn(),
          getDesiredImageStateForRef: vi.fn(),
          getPublicUrlForPort: vi.fn().mockReturnValue("https://studio.example:4100"),
          getPublicUrlForRoutePath: vi
            .fn()
            .mockReturnValue("https://app.example/_studio/site-1-v1"),
          getInternalProxyUrlForRoutePath: vi
            .fn()
            .mockReturnValue("http://caddy/_studio/site-1-v1"),
          startTimeoutMs: 60_000,
          touchKey: vi.fn().mockImplementation(() => {
            callOrder.push("touch");
          }),
          waitForReady: vi.fn().mockImplementation(async () => {
            expect(callOrder).toEqual(["start", "touch"]);
            callOrder.push("wait");
          }),
        },
        {
          organizationId: "org-1",
          projectSlug: "site-1",
          version: 1,
          env: {},
        },
        {
          Id: "container-1",
          Name: "/studio-site-1-v1-a3f6fad7ba",
          Config: {
            Env: ["STUDIO_ID=studio-1"],
            Labels: {
              vivd_studio_id: "studio-1",
              vivd_route_id: "site-1-v1",
            },
          },
          State: {
            Status: "exited",
          },
          HostConfig: {
            PortBindings: {
              "3100/tcp": [{ HostPort: "4100" }],
            },
          },
        } as any,
        "access-token-1",
        "ghcr.io/vivd-studio/vivd-studio:latest",
      ),
    ).resolves.toMatchObject({
      studioId: "studio-1",
      url: "https://studio.example:4100",
    });

    expect(callOrder).toEqual(["start", "touch", "wait", "touch"]);
  });
});
