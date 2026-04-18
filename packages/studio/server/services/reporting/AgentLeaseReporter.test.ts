import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vivd/shared", () => ({
  isConnectedMode: () => true,
}));

vi.mock("../../lib/connectedBackendAuth.js", () => ({
  buildConnectedBackendHeaders: () => ({
    "content-type": "application/json",
  }),
  getConnectedBackendAuthConfig: () => ({
    backendUrl: "https://backend.vivd.test",
    studioId: "studio-1",
  }),
}));

import { AgentLeaseReporter } from "./AgentLeaseReporter.js";

function buildOkResponse() {
  return {
    ok: true,
    json: async () => ({
      result: {
        data: {
          json: {
            leaseState: "active",
          },
        },
      },
    }),
    text: async () => "",
  } as Response;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("AgentLeaseReporter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(buildOkResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("pauses heartbeats during suspend prep and resumes them afterwards", async () => {
    const reporter = new AgentLeaseReporter();

    reporter.startRun({
      runId: "run-1",
      sessionId: "session-1",
      projectSlug: "site-1",
      version: 1,
    });
    expect(reporter.hasActiveSession("session-1")).toBe(true);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await reporter.pauseForSuspend();
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();

    reporter.resume();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    reporter.finishRun("run-1");
    expect(reporter.hasActiveSession("session-1")).toBe(false);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
