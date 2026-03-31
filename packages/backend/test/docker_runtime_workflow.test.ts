import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureContainerRunningWorkflow,
  waitForReadyWorkflow,
} from "../src/services/studioMachines/docker/runtimeWorkflow";

describe("docker runtime workflow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
