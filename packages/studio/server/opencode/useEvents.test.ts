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
});
