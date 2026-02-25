import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  isConnectedModeMock,
  getBackendUrlMock,
  getSessionTokenMock,
  getStudioIdMock,
  getConnectedOrganizationIdMock,
} = vi.hoisted(() => ({
  isConnectedModeMock: vi.fn(),
  getBackendUrlMock: vi.fn(),
  getSessionTokenMock: vi.fn(),
  getStudioIdMock: vi.fn(),
  getConnectedOrganizationIdMock: vi.fn(),
}));

vi.mock("@vivd/shared", () => ({
  isConnectedMode: isConnectedModeMock,
  getBackendUrl: getBackendUrlMock,
  getSessionToken: getSessionTokenMock,
  getStudioId: getStudioIdMock,
  getConnectedOrganizationId: getConnectedOrganizationIdMock,
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ThumbnailGenerationReporter", () => {
  const originalFetch = globalThis.fetch;
  const originalMachineSlug = process.env.VIVD_PROJECT_SLUG;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T00:00:00.000Z"));
    vi.resetModules();
    delete process.env.VIVD_PROJECT_SLUG;

    isConnectedModeMock.mockReset();
    getBackendUrlMock.mockReset();
    getSessionTokenMock.mockReset();
    getStudioIdMock.mockReset();
    getConnectedOrganizationIdMock.mockReset();

    isConnectedModeMock.mockReturnValue(true);
    getBackendUrlMock.mockReturnValue("https://backend.vivd.test");
    getSessionTokenMock.mockReturnValue("session-token");
    getStudioIdMock.mockReturnValue("studio-1");
    getConnectedOrganizationIdMock.mockReturnValue("org-1");

    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalMachineSlug === undefined) {
      delete process.env.VIVD_PROJECT_SLUG;
    } else {
      process.env.VIVD_PROJECT_SLUG = originalMachineSlug;
    }
    vi.useRealTimers();
  });

  it("applies a long cooldown after NOT_FOUND errors", async () => {
    const { thumbnailGenerationReporter } = await import("./ThumbnailGenerationReporter.js");

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({
          error: { data: { code: "NOT_FOUND" } },
        }),
    });

    thumbnailGenerationReporter.request("missing-site", 1);
    await flushAsync();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000); // past request throttle
    thumbnailGenerationReporter.request("missing-site", 1);
    await flushAsync();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(120_001); // long 404 cooldown window
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "",
    });
    thumbnailGenerationReporter.request("missing-site", 1);
    await flushAsync();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("prefers machine slug over request slug when reporting", async () => {
    process.env.VIVD_PROJECT_SLUG = "canonical-site";
    const { thumbnailGenerationReporter } = await import("./ThumbnailGenerationReporter.js");

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "",
    });

    thumbnailGenerationReporter.request("stale-route-slug", 2);
    await flushAsync();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const call = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1]?.body ?? "{}") as { slug?: string; version?: number };
    expect(body.slug).toBe("canonical-site");
    expect(body.version).toBe(2);
  });
});
