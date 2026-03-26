import { afterEach, describe, expect, it } from "vitest";
import { canonicalEventBridge } from "./canonicalEventBridge.js";

async function nextResult<T>(
  nextPromise: Promise<IteratorResult<T>>,
  timeoutMs = 1_000,
): Promise<IteratorResult<T>> {
  return await Promise.race([
    nextPromise,
    new Promise<IteratorResult<T>>((_, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for event")), timeoutMs);
    }),
  ]);
}

describe("canonicalEventBridge", () => {
  afterEach(() => {
    canonicalEventBridge.clearWorkspace("/tmp/workspace-a");
    canonicalEventBridge.clearWorkspace("/tmp/workspace-b");
  });

  it("replays buffered workspace events after the last seen event id", async () => {
    const workspaceKey = canonicalEventBridge.createWorkspaceKey("/tmp/workspace-a");
    const first = canonicalEventBridge.emitBridgeStatus(workspaceKey, "connected");
    const second = canonicalEventBridge.emitOpencodeEvent(workspaceKey, {
      type: "message.updated",
      properties: {
        sessionID: "sess-1",
        info: { id: "msg-1", role: "assistant" },
      },
    });
    const third = canonicalEventBridge.emitOpencodeEvent(workspaceKey, {
      type: "message.part.delta",
      properties: {
        sessionID: "sess-1",
        messageID: "msg-1",
        partID: "part-1",
        field: "text",
        delta: "hello",
      },
    });

    const iterator = canonicalEventBridge
      .createWorkspaceStream("/tmp/workspace-a", undefined, first.eventId)
      [Symbol.asyncIterator]();

    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    expect((await nextResult(iterator.next())).value?.eventId).toBe(second?.eventId);
    expect((await nextResult(iterator.next())).value?.eventId).toBe(third?.eventId);

    await iterator.return?.(undefined);
  });

  it("isolates live events by workspace", async () => {
    const workspaceA = canonicalEventBridge.createWorkspaceKey("/tmp/workspace-a");
    const workspaceB = canonicalEventBridge.createWorkspaceKey("/tmp/workspace-b");
    const iterator = canonicalEventBridge
      .createWorkspaceStream("/tmp/workspace-a")
      [Symbol.asyncIterator]();
    const pendingNext = iterator.next();

    canonicalEventBridge.emitOpencodeEvent(workspaceB, {
      type: "message.updated",
      properties: {
        sessionID: "sess-b",
        info: { id: "msg-b", role: "assistant" },
      },
    });

    const expected = canonicalEventBridge.emitOpencodeEvent(workspaceA, {
      type: "message.updated",
      properties: {
        sessionID: "sess-a",
        info: { id: "msg-a", role: "assistant" },
      },
    });

    expect(expected).not.toBeNull();
    const next = await nextResult(pendingNext);
    expect(next.value?.eventId).toBe(expected?.eventId);
    expect(next.value?.sessionId).toBe("sess-a");

    await iterator.return?.(undefined);
  });

  it("does not replay buffered events for a fresh live-only subscription", async () => {
    const workspaceKey = canonicalEventBridge.createWorkspaceKey("/tmp/workspace-a");
    canonicalEventBridge.emitBridgeStatus(workspaceKey, "connected");
    canonicalEventBridge.emitOpencodeEvent(workspaceKey, {
      type: "message.updated",
      properties: {
        sessionID: "sess-a",
        info: { id: "msg-old", role: "assistant" },
      },
    });

    const iterator = canonicalEventBridge
      .createWorkspaceStream("/tmp/workspace-a", undefined, undefined, false)
      [Symbol.asyncIterator]();
    const pendingNext = iterator.next();

    const expected = canonicalEventBridge.emitOpencodeEvent(workspaceKey, {
      type: "message.updated",
      properties: {
        sessionID: "sess-a",
        info: { id: "msg-live", role: "assistant" },
      },
    });

    expect((await nextResult(pendingNext)).value?.eventId).toBe(expected?.eventId);

    await iterator.return?.(undefined);
  });
});
