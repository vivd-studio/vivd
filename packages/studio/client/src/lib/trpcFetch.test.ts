import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStudioTrpcFetch } from "./trpcFetch";

describe("createStudioTrpcFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a network-level transport failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const reportTransportDegraded = vi.fn();
    const studioFetch = createStudioTrpcFetch({
      studioToken: "studio-token",
      fetchImpl,
      reportTransportDegraded,
      resolveTimeoutMs: () => 5_000,
    });

    await expect(
      studioFetch("https://studio.example.com/vivd-studio/api/trpc"),
    ).rejects.toThrow("Failed to fetch");

    expect(reportTransportDegraded).toHaveBeenCalledWith({
      transport: "trpc-http",
      reason: "network-error",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://studio.example.com/vivd-studio/api/trpc",
      expect.objectContaining({
        credentials: "include",
        headers: expect.any(Headers),
        signal: expect.any(AbortSignal),
      }),
    );

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("x-vivd-studio-token")).toBe("studio-token");
  });

  it("reports a timeout-based transport failure", async () => {
    const fetchImpl = vi.fn(
      (_, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Timed out", "AbortError"));
          });
        }),
    );
    const reportTransportDegraded = vi.fn();
    const studioFetch = createStudioTrpcFetch({
      studioToken: null,
      fetchImpl,
      reportTransportDegraded,
      resolveTimeoutMs: () => 10,
    });

    const request = studioFetch("https://studio.example.com/vivd-studio/api/trpc");
    const expectation = expect(request).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(15);

    await expectation;
    expect(reportTransportDegraded).toHaveBeenCalledWith({
      transport: "trpc-http",
      reason: "timeout",
    });
  });

  it("does not report when the caller aborts the request", async () => {
    const fetchImpl = vi.fn(
      (_, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const reportTransportDegraded = vi.fn();
    const studioFetch = createStudioTrpcFetch({
      studioToken: null,
      fetchImpl,
      reportTransportDegraded,
      resolveTimeoutMs: () => 5_000,
    });
    const controller = new AbortController();

    const request = studioFetch(
      "https://studio.example.com/vivd-studio/api/trpc",
      {
        signal: controller.signal,
      },
    );
    const expectation = expect(request).rejects.toThrow();

    controller.abort();

    await expectation;
    expect(reportTransportDegraded).not.toHaveBeenCalled();
  });
});
