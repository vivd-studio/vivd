import { describe, expect, it } from "vitest";
import { calculateUsageFromSessionMessages } from "./sessionMetrics";

describe("sessionMetrics", () => {
  it("aggregates assistant usage totals from session history", () => {
    const usage = calculateUsageFromSessionMessages([
      {
        info: {
          id: "a1",
          sessionID: "sess-1",
          role: "assistant",
          cost: 1.5,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 3,
            cache: { read: 1, write: 2 },
          },
        } as any,
        parts: [],
      },
      {
        info: {
          id: "a2",
          sessionID: "sess-1",
          role: "assistant",
          cost: 0.5,
          tokens: {
            input: 1,
            output: 2,
            reasoning: 0,
            cache: { read: 0, write: 1 },
          },
        } as any,
        parts: [],
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

  it("returns null when assistant usage is unavailable", () => {
    const usage = calculateUsageFromSessionMessages([
      {
        info: {
          id: "u1",
          sessionID: "sess-1",
          role: "user",
        },
        parts: [],
      },
    ]);

    expect(usage).toBeNull();
  });
});
