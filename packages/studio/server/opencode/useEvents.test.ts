import { describe, expect, it, vi } from "vitest";
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
});
