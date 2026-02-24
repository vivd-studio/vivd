import { describe, expect, it } from "vitest";
import {
  calculateUsageFromSessionMessages,
  mapSessionMessagesToChatMessages,
  shouldRecoverFromMissedStreamEvents,
} from "./chatMessageUtils";

describe("chatMessageUtils", () => {
  it("normalizes persisted message parts when mapping session messages", () => {
    const mapped = mapSessionMessagesToChatMessages([
      {
        info: { id: "m1", role: "assistant" },
        parts: [
          { type: "reasoning", text: "[REDACTED]" },
          { type: "text", text: "Hello" },
          {
            type: "tool",
            tool: "read",
            state: {
              status: "error",
              error: { message: "boom" },
            },
          },
        ],
      },
    ]);

    expect(mapped).toEqual([
      {
        id: "m1",
        role: "agent",
        content: "Hello",
        parts: [
          { type: "text", text: "Hello" },
          {
            type: "tool",
            tool: "read",
            state: {
              status: "error",
              error: { message: "boom" },
            },
            status: "error",
            input: undefined,
            error: "boom",
          },
        ],
      },
    ]);
  });

  it("aggregates assistant usage totals from session history", () => {
    const usage = calculateUsageFromSessionMessages([
      {
        info: {
          role: "assistant",
          cost: 1.5,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 3,
            cache: { read: 1, write: 2 },
          },
        },
      },
      {
        info: {
          role: "assistant",
          cost: 0.5,
          tokens: {
            input: 1,
            output: 2,
            reasoning: 0,
            cache: { read: 0, write: 1 },
          },
        },
      },
    ]);

    expect(usage).toEqual({
      cost: 2,
      tokens: {
        input: 11,
        output: 22,
        reasoning: 3,
        cache: { read: 1, write: 3 },
      },
    });
  });

  it("detects when polling should recover missed stream completion", () => {
    const shouldRecover = shouldRecoverFromMissedStreamEvents(
      [
        { role: "user", content: "Fix it" },
        { role: "agent", content: "Done" },
      ],
      [{ role: "user", content: "Fix it" }],
    );

    expect(shouldRecover).toBe(true);
  });

  it("does not recover when latest fetched message is not an agent reply", () => {
    const shouldRecover = shouldRecoverFromMissedStreamEvents(
      [{ role: "user", content: "Fix it" }],
      [{ role: "user", content: "Fix it" }],
    );

    expect(shouldRecover).toBe(false);
  });
});
