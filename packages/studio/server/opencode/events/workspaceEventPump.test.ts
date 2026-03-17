import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getClientAndDirectoryMock,
  emitBridgeStatusMock,
  emitOpencodeEventMock,
} = vi.hoisted(() => ({
  getClientAndDirectoryMock: vi.fn(),
  emitBridgeStatusMock: vi.fn(),
  emitOpencodeEventMock: vi.fn(),
}));

vi.mock("../serverManager.js", () => ({
  serverManager: {
    getClientAndDirectory: getClientAndDirectoryMock,
  },
}));

vi.mock("./canonicalEventBridge.js", () => ({
  canonicalEventBridge: {
    emitBridgeStatus: emitBridgeStatusMock,
    emitOpencodeEvent: emitOpencodeEventMock,
  },
}));

import { workspaceEventPump } from "./workspaceEventPump.js";

function makeClient(event: any) {
  return {
    event: {
      subscribe: vi.fn(async (_input: unknown, options?: { signal?: AbortSignal }) => ({
        stream: (async function* () {
          yield event;
          await new Promise<void>((resolve) => {
            options?.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
        })(),
      })),
    },
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("workspaceEventPump", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getClientAndDirectoryMock.mockReset();
    emitBridgeStatusMock.mockReset();
    emitOpencodeEventMock.mockReset();
  });

  afterEach(() => {
    workspaceEventPump.stop("/tmp/workspace-pump");
    vi.useRealTimers();
  });

  it("starts one pump per workspace and forwards canonical events", async () => {
    const rawEvent = {
      type: "message.updated",
      properties: {
        sessionID: "sess-1",
        info: { id: "msg-1", role: "assistant" },
      },
    };
    const client = makeClient(rawEvent);
    getClientAndDirectoryMock.mockResolvedValue({ client });

    const releaseA = await workspaceEventPump.acquire("/tmp/workspace-pump");
    const releaseB = await workspaceEventPump.acquire("/tmp/workspace-pump");

    await flushAsyncWork();

    expect(getClientAndDirectoryMock).toHaveBeenCalledTimes(1);
    expect(client.event.subscribe).toHaveBeenCalledTimes(1);
    expect(emitBridgeStatusMock).toHaveBeenCalledWith(
      "/tmp/workspace-pump",
      "connected",
    );
    expect(emitOpencodeEventMock).toHaveBeenCalledWith(
      "/tmp/workspace-pump",
      rawEvent,
    );

    releaseA();
    releaseB();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(emitBridgeStatusMock).toHaveBeenCalledWith(
      "/tmp/workspace-pump",
      "disconnected",
    );
  });

  it("temporary retain acquires and later releases the workspace pump", async () => {
    const client = makeClient({
      type: "session.status",
      properties: { sessionID: "sess-2", status: { type: "busy" } },
    });
    getClientAndDirectoryMock.mockResolvedValue({ client });

    await workspaceEventPump.retainTemporarily("/tmp/workspace-pump", 100);
    await flushAsyncWork();

    expect(getClientAndDirectoryMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(emitBridgeStatusMock).toHaveBeenCalledWith(
      "/tmp/workspace-pump",
      "disconnected",
    );
  });
});
