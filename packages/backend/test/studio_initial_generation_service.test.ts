import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureRunningMock,
  providerKindMock,
  resolveStableStudioMachineEnvMock,
} = vi.hoisted(() => ({
  ensureRunningMock: vi.fn(),
  providerKindMock: { value: "fly" as "fly" | "docker" | "local" },
  resolveStableStudioMachineEnvMock: vi.fn(),
}));

vi.mock("../src/services/studioMachines", () => ({
  studioMachineProvider: {
    get kind() {
      return providerKindMock.value;
    },
    ensureRunning: ensureRunningMock,
  },
}));

vi.mock("../src/services/studioMachines/stableRuntimeEnv", () => ({
  resolveStableStudioMachineEnv: resolveStableStudioMachineEnvMock,
}));

import { startStudioInitialGeneration } from "../src/services/project/StudioInitialGenerationService";

function mockResponse(
  payload: unknown,
  options: { ok?: boolean; status?: number; text?: string } = {},
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => payload,
    text: async () =>
      options.text ?? (typeof payload === "string" ? payload : JSON.stringify(payload)),
  } as Response;
}

describe("StudioInitialGenerationService", () => {
  beforeEach(() => {
    ensureRunningMock.mockReset();
    providerKindMock.value = "fly";
    resolveStableStudioMachineEnvMock.mockReset();
    resolveStableStudioMachineEnvMock.mockResolvedValue({
      MAIN_BACKEND_URL: "https://default.vivd.studio/vivd-studio",
    });
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for the studio runtime to report healthy and then starts initial generation via runtime auth", async () => {
    vi.useFakeTimers();

    ensureRunningMock.mockResolvedValue({
      studioId: "studio-1",
      url: "https://fallback.example/runtime-123",
      runtimeUrl: "https://studio.example/runtime-123",
      compatibilityUrl: "https://app.example/_studio/runtime-123",
      accessToken: "studio-token-1",
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mockResponse({ status: "starting" }))
      .mockResolvedValueOnce(mockResponse({ status: "ok" }))
      .mockResolvedValueOnce(
        mockResponse({
          result: {
            data: {
              json: {
                sessionId: "sess-1",
                reused: false,
                status: "generating_initial_site",
              },
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const promise = startStudioInitialGeneration({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
      requestHost: "org-1.vivd.studio",
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toEqual({
      sessionId: "sess-1",
      reused: false,
      status: "generating_initial_site",
    });

    expect(resolveStableStudioMachineEnvMock).toHaveBeenCalledWith({
      providerKind: "fly",
      organizationId: "org-1",
      projectSlug: "site-1",
      requestHost: "org-1.vivd.studio",
    });
    expect(ensureRunningMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
      env: {
        MAIN_BACKEND_URL: "https://default.vivd.studio/vivd-studio",
      },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://studio.example/runtime-123/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://studio.example/runtime-123/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://studio.example/runtime-123/vivd-studio/api/trpc/agent.startInitialGeneration",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-vivd-studio-token": "studio-token-1",
        }),
        body: JSON.stringify({
          projectSlug: "site-1",
          version: 1,
        }),
      }),
    );
  });

  it("falls back to the compatibility URL when no direct runtime URL is available", async () => {
    ensureRunningMock.mockResolvedValue({
      studioId: "studio-1",
      url: "https://fallback.example/runtime-123",
      backendUrl: null,
      runtimeUrl: null,
      compatibilityUrl: "https://app.example/_studio/runtime-123",
      accessToken: "studio-token-1",
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mockResponse({ status: "ok" }))
      .mockResolvedValueOnce(
        mockResponse({
          sessionId: "sess-2",
          reused: true,
          status: "generating_initial_site",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startStudioInitialGeneration({
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
      }),
    ).resolves.toEqual({
      sessionId: "sess-2",
      reused: true,
      status: "generating_initial_site",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://app.example/_studio/runtime-123/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://app.example/_studio/runtime-123/vivd-studio/api/trpc/agent.startInitialGeneration",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("prefers the provider-supplied backend URL for Docker-managed runtimes", async () => {
    providerKindMock.value = "docker";

    ensureRunningMock.mockResolvedValue({
      studioId: "studio-1",
      url: "http://app.localhost:4100",
      backendUrl: "http://studio-site-1-v1-a3f6fad7ba:3100",
      runtimeUrl: "http://app.localhost:4100",
      compatibilityUrl: "http://app.localhost/_studio/site-1-v1",
      accessToken: "studio-token-1",
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mockResponse({ status: "ok" }))
      .mockResolvedValueOnce(
        mockResponse({
          sessionId: "sess-3",
          reused: false,
          status: "generating_initial_site",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startStudioInitialGeneration({
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
      }),
    ).resolves.toEqual({
      sessionId: "sess-3",
      reused: false,
      status: "generating_initial_site",
    });

    expect(resolveStableStudioMachineEnvMock).toHaveBeenCalledWith({
      providerKind: "docker",
      organizationId: "org-1",
      projectSlug: "site-1",
      requestHost: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://studio-site-1-v1-a3f6fad7ba:3100/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://studio-site-1-v1-a3f6fad7ba:3100/vivd-studio/api/trpc/agent.startInitialGeneration",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails fast when the studio runtime does not expose an access token", async () => {
    ensureRunningMock.mockResolvedValue({
      studioId: "studio-1",
      url: "https://studio.example/runtime-123",
      backendUrl: "https://studio.example/runtime-123",
      runtimeUrl: "https://studio.example/runtime-123",
      compatibilityUrl: null,
      accessToken: "",
    });

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startStudioInitialGeneration({
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
      }),
    ).rejects.toThrow("Studio runtime started without an access token");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
