import { describe, expect, it } from "vitest";
import {
  calculateUsageFromSessionMessages,
  hasFinalAgentResponse,
  mapSessionMessagesToChatMessages,
  shouldRecoverFromMissedStreamEvents,
  shouldSuggestInterruptedContinue,
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

  it("maps message timestamps from session metadata", () => {
    const mapped = mapSessionMessagesToChatMessages([
      {
        info: {
          id: "m-user",
          role: "user",
          time: { created: 1700000000 },
        },
        parts: [{ type: "text", text: "Hi" }],
      },
      {
        info: {
          id: "m-agent",
          role: "assistant",
          time: { created: "2026-02-24T22:00:00.000Z" },
        },
        parts: [{ type: "text", text: "Hello" }],
      },
    ]);

    expect(mapped[0]).toMatchObject({
      id: "m-user",
      role: "user",
      createdAt: 1700000000 * 1000,
    });
    expect(mapped[1]).toMatchObject({
      id: "m-agent",
      role: "agent",
      createdAt: Date.parse("2026-02-24T22:00:00.000Z"),
    });
  });

  it("merges contiguous assistant messages into a single agent message", () => {
    const mapped = mapSessionMessagesToChatMessages([
      {
        info: { id: "u1", role: "user", time: { created: 1700000000 } },
        parts: [{ type: "text", text: "Fix this" }],
      },
      {
        info: { id: "a1", role: "assistant", time: { created: 1700000001 } },
        parts: [{ id: "t1", type: "tool", tool: "read", status: "completed" }],
      },
      {
        info: { id: "a2", role: "assistant", time: { created: 1700000002 } },
        parts: [{ type: "text", text: "Done" }],
      },
    ]);

    expect(mapped).toHaveLength(2);
    expect(mapped[1]).toMatchObject({
      id: "a2",
      role: "agent",
      content: "Done",
      createdAt: 1700000002 * 1000,
    });
    expect(mapped[1].parts).toHaveLength(2);
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

  it("detects when the final response is still missing from the agent", () => {
    expect(
      hasFinalAgentResponse([
        { role: "user", content: "Please continue" },
        { role: "agent", content: "" },
      ]),
    ).toBe(false);

    expect(
      hasFinalAgentResponse([
        { role: "user", content: "Please continue" },
        { role: "agent", content: "Sure, here is the result." },
      ]),
    ).toBe(true);
  });

  it("suggests a continue nudge when session is done without final agent response", () => {
    const shouldSuggest = shouldSuggestInterruptedContinue({
      sessionStatus: "done",
      messages: [{ role: "user", content: "Do the task" }],
      isThinking: false,
      isLoading: false,
    });

    expect(shouldSuggest).toBe(true);
  });

  it("suggests a continue nudge when session is idle without final agent response", () => {
    const shouldSuggest = shouldSuggestInterruptedContinue({
      sessionStatus: "idle",
      messages: [{ role: "user", content: "Do the task" }],
      isThinking: false,
      isLoading: false,
    });

    expect(shouldSuggest).toBe(true);
  });

  it("does not suggest continue once a final agent response exists", () => {
    const shouldSuggest = shouldSuggestInterruptedContinue({
      sessionStatus: "done",
      messages: [
        { role: "user", content: "Do the task" },
        { role: "agent", content: "Done." },
      ],
      isThinking: false,
      isLoading: false,
    });

    expect(shouldSuggest).toBe(false);
  });

  it("does not suggest continue when session is still active", () => {
    const shouldSuggest = shouldSuggestInterruptedContinue({
      sessionStatus: "busy",
      messages: [{ role: "user", content: "Do the task" }],
      isThinking: false,
      isLoading: false,
    });

    expect(shouldSuggest).toBe(false);
  });

  it("does not suggest continue again when latest user message is already continue", () => {
    const shouldSuggest = shouldSuggestInterruptedContinue({
      sessionStatus: "idle",
      messages: [
        { role: "user", content: "Do the task" },
        { role: "user", content: "Continue" },
      ],
      isThinking: false,
      isLoading: false,
    });

    expect(shouldSuggest).toBe(false);
  });
});
