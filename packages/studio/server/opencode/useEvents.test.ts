import { afterEach, describe, expect, it, vi } from "vitest";
import { useEvents } from "./useEvents.js";

function makeClient(events: any[]) {
  return {
    event: {
      subscribe: vi.fn(async () => ({
        stream: (async function* () {
          for (const event of events) {
            await Promise.resolve();
            yield event;
          }
        })(),
      })),
    },
  } as any;
}

async function flushEventLoop() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("useEvents", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not mirror user text when text part arrives before role metadata", async () => {
    const onText = vi.fn();

    const client = makeClient([
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-no-mirror",
          part: {
            id: "text-user-1",
            messageID: "user-no-mirror",
            type: "text",
            text: "a long one",
          },
        },
      },
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-no-mirror",
          info: { id: "user-no-mirror", role: "user" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-no-mirror",
          part: {
            id: "text-user-1",
            messageID: "user-no-mirror",
            type: "text",
            text: "a long one!",
          },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-no-mirror",
      onText,
    });
    await start();
    await flushEventLoop();
    stop();

    expect(onText).not.toHaveBeenCalled();
  });

  it("streams text parts even when part.updated arrives before message.updated", async () => {
    const onText = vi.fn();

    const client = makeClient([
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-order",
          part: {
            id: "text-order-1",
            messageID: "assistant-order",
            type: "text",
            text: "hello",
          },
        },
      },
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-order",
          info: { id: "assistant-order", role: "assistant" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-order",
          part: {
            id: "text-order-1",
            messageID: "assistant-order",
            type: "text",
            text: "hello world",
          },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-order",
      onText,
    });
    await start();
    await flushEventLoop();
    stop();

    expect(onText).toHaveBeenNthCalledWith(1, "hello", "text-order-1");
    expect(onText).toHaveBeenNthCalledWith(2, " world", "text-order-1");
  });

  it("prefers native message.part.updated delta payloads for text streaming", async () => {
    const onText = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-delta",
          info: { id: "assistant-delta", role: "assistant" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-delta",
          part: {
            id: "text-1",
            messageID: "assistant-delta",
            type: "text",
            text: "hello ",
          },
          delta: "hello ",
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-delta",
          part: {
            id: "text-1",
            messageID: "assistant-delta",
            type: "text",
            text: "hello world",
          },
          delta: "world",
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-delta",
      onText,
    });
    await start();
    await flushEventLoop();
    stop();

    expect(onText).toHaveBeenNthCalledWith(1, "hello ", "text-1");
    expect(onText).toHaveBeenNthCalledWith(2, "world", "text-1");
  });

  it("buffers unknown part.delta text until assistant role is known", async () => {
    const onText = vi.fn();

    const client = makeClient([
      {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-delta-order",
          messageID: "assistant-delta-order",
          partID: "text-delta-order-1",
          field: "text",
          delta: "hello ",
        },
      },
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-delta-order",
          info: { id: "assistant-delta-order", role: "assistant" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-delta-order",
          messageID: "assistant-delta-order",
          partID: "text-delta-order-1",
          field: "text",
          delta: "world",
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-delta-order",
      onText,
    });
    await start();
    await flushEventLoop();
    stop();

    expect(onText).toHaveBeenNthCalledWith(1, "hello ", "text-delta-order-1");
    expect(onText).toHaveBeenNthCalledWith(2, "world", "text-delta-order-1");
  });

  it("streams native message.part.delta events for assistant text", async () => {
    const onText = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-part-delta",
          info: { id: "assistant-part-delta", role: "assistant" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-part-delta",
          messageID: "assistant-part-delta",
          partID: "text-part-delta-1",
          field: "text",
          delta: "hello ",
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-part-delta",
          messageID: "assistant-part-delta",
          partID: "text-part-delta-1",
          field: "text",
          delta: "world",
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-part-delta",
      onText,
    });
    await start();
    await flushEventLoop();
    stop();

    expect(onText).toHaveBeenNthCalledWith(1, "hello ", "text-part-delta-1");
    expect(onText).toHaveBeenNthCalledWith(2, "world", "text-part-delta-1");
  });

  it("forwards tool error details from state.error", async () => {
    const onToolCall = vi.fn();
    const onToolCallFinished = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-1",
          info: { id: "assistant-1", role: "assistant" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-1",
          part: {
            id: "tool-1",
            messageID: "assistant-1",
            type: "tool",
            tool: "read",
            state: {
              status: "running",
              input: { path: "hero.avif" },
            },
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-1",
          part: {
            id: "tool-1",
            messageID: "assistant-1",
            type: "tool",
            tool: "read",
            state: {
              status: "error",
              error: { message: "unsupported image format: .avif" },
            },
          },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-1",
      onToolCall,
      onToolCallFinished,
    });
    await start();
    await flushEventLoop();
    stop();

    expect(onToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tool-1",
        tool: "read",
        status: "running",
        input: { path: "hero.avif" },
      }),
    );
    expect(onToolCallFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tool-1",
        tool: "read",
        status: "error",
        error: "unsupported image format: .avif",
      }),
    );
  });

  it("supports tool events that use direct status/error fields without state", async () => {
    const onToolCallFinished = vi.fn();
    const onSessionError = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-2",
          info: { id: "assistant-2", role: "assistant" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-2",
          part: {
            id: "tool-2",
            messageID: "assistant-2",
            type: "tool",
            tool: "read",
            status: "error",
            error: "file type .avif is not supported",
          },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-2",
      onToolCallFinished,
      onSessionError,
    });
    await start();
    await flushEventLoop();
    stop();

    expect(onSessionError).not.toHaveBeenCalled();
    expect(onToolCallFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tool-2",
        tool: "read",
        status: "error",
        error: "file type .avif is not supported",
      }),
    );
  });

  it("does not fabricate an error for completed tool events", async () => {
    const onToolCallFinished = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-2b",
          info: { id: "assistant-2b", role: "assistant" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-2b",
          part: {
            id: "tool-2b",
            messageID: "assistant-2b",
            type: "tool",
            tool: "bash",
            status: "completed",
            output: "ok",
          },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-2b",
      onToolCallFinished,
    });
    await start();
    await flushEventLoop();
    stop();

    expect(onToolCallFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tool-2b",
        tool: "bash",
        status: "completed",
      }),
    );
    expect(onToolCallFinished.mock.calls[0]?.[0]?.error).toBeUndefined();
  });

  it("does not emit idle completion after a terminal session.status error", async () => {
    const onSessionError = vi.fn();
    const onIdle = vi.fn();

    const client = makeClient([
      {
        type: "session.status",
        properties: {
          sessionID: "sess-3",
          status: { type: "busy" },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-3",
          status: {
            type: "error",
            message:
              "This request requires more credits, or fewer max tokens.",
          },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-3",
          status: { type: "idle" },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-3",
      onSessionError,
      onIdle,
    });
    await start();
    await flushEventLoop();
    stop();

    expect(onSessionError).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
      }),
    );
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("does not treat busy->idle with no assistant activity as completion", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    const client = makeClient([
      {
        type: "session.status",
        properties: {
          sessionID: "sess-empty",
          status: { type: "busy" },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-empty",
          status: { type: "idle" },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-empty",
      onIdle,
    });
    await start();
    await vi.runAllTimersAsync();
    stop();

    expect(onIdle).not.toHaveBeenCalled();
  });

  it("does not treat user text parts as assistant activity for idle completion", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-user-part",
          info: { id: "user-part", role: "user" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-user-part",
          part: {
            id: "text-user-part-1",
            messageID: "user-part",
            type: "text",
            text: "were you finished?",
          },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-user-part",
          status: { type: "idle" },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-user-part",
      onIdle,
    });
    await start();
    await vi.runAllTimersAsync();
    stop();

    expect(onIdle).not.toHaveBeenCalled();
  });

  it("does not treat user text deltas as assistant activity for idle completion", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-user-delta",
          info: { id: "user-delta", role: "user" },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-user-delta",
          messageID: "user-delta",
          partID: "text-user-delta-1",
          field: "text",
          delta: "continue",
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-user-delta",
          status: { type: "idle" },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-user-delta",
      onIdle,
    });
    await start();
    await vi.runAllTimersAsync();
    stop();

    expect(onIdle).not.toHaveBeenCalled();
  });

  it("treats reasoning parts as assistant activity even before role metadata arrives", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    const client = makeClient([
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-reasoning-first",
          part: {
            id: "reasoning-1",
            messageID: "assistant-reasoning-first",
            type: "reasoning",
            text: "Scanning the project",
          },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-reasoning-first",
          status: { type: "done" },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-reasoning-first",
      onIdle,
    });
    await start();
    await vi.runAllTimersAsync();
    stop();

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("debounces transient idle states until the session stays idle", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-transient-idle",
          info: { id: "assistant-transient", role: "assistant" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-transient-idle",
          part: {
            id: "text-transient-1",
            messageID: "assistant-transient",
            type: "text",
            text: "Starting with a quick scan",
          },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-transient-idle",
          status: { type: "idle" },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-transient-idle",
          status: { type: "busy" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-transient-idle",
          part: {
            id: "tool-transient-1",
            messageID: "assistant-transient",
            type: "tool",
            tool: "glob",
            status: "completed",
          },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-transient-idle",
          status: { type: "done" },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-transient-idle",
      onIdle,
    });
    await start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onIdle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    stop();

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("treats session.status done as terminal completion after assistant activity", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-done",
          info: { id: "assistant-done", role: "assistant" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-done",
          part: {
            id: "text-done-1",
            messageID: "assistant-done",
            type: "text",
            text: "Drafting the site now",
          },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-done",
          status: { type: "busy" },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "sess-done",
          status: { type: "done" },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-done",
      onIdle,
    });
    await start();
    await vi.runAllTimersAsync();
    stop();

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("treats session.updated after a completed tool as a settled assistant boundary", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-session-updated",
          info: { id: "assistant-session-updated", role: "assistant" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-session-updated",
          part: {
            id: "tool-session-updated-1",
            messageID: "assistant-session-updated",
            type: "tool",
            tool: "edit",
            state: {
              status: "completed",
              input: { file: "index.html" },
            },
          },
        },
      },
      {
        type: "session.updated",
        properties: {
          sessionID: "sess-session-updated",
          info: {
            id: "sess-session-updated",
            time: { updated: Date.now() },
          },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-session-updated",
      onIdle,
    });
    await start();
    await vi.runAllTimersAsync();
    stop();

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does not treat session.updated as settled while a tool is still running", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();

    const client = makeClient([
      {
        type: "message.updated",
        properties: {
          sessionID: "sess-session-running-tool",
          info: { id: "assistant-session-running-tool", role: "assistant" },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "sess-session-running-tool",
          part: {
            id: "tool-session-running-tool-1",
            messageID: "assistant-session-running-tool",
            type: "tool",
            tool: "edit",
            state: {
              status: "running",
              input: { file: "index.html" },
            },
          },
        },
      },
      {
        type: "session.updated",
        properties: {
          sessionID: "sess-session-running-tool",
          info: {
            id: "sess-session-running-tool",
            time: { updated: Date.now() },
          },
        },
      },
    ]);

    const { start, stop } = useEvents(client, {
      sessionId: "sess-session-running-tool",
      onIdle,
    });
    await start();
    await vi.runAllTimersAsync();
    stop();

    expect(onIdle).not.toHaveBeenCalled();
  });
});
