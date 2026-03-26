import { describe, expect, it } from "vitest";
import { getSessionContextMetrics } from "./sessionContextMetrics";

describe("sessionContextMetrics", () => {
  it("uses the latest assistant token snapshot and matched model limit", () => {
    const metrics = getSessionContextMetrics(
      [
        {
          info: {
            id: "u1",
            sessionID: "sess-1",
            role: "user",
          } as any,
          parts: [],
        },
        {
          info: {
            id: "a1",
            sessionID: "sess-1",
            role: "assistant",
            providerID: "openai",
            modelID: "gpt-4.1-mini",
            cost: 0.2,
            time: {
              completed: 100,
            },
            tokens: {
              input: 100,
              output: 40,
              reasoning: 10,
              cache: { read: 5, write: 0 },
            },
          } as any,
          parts: [],
        },
        {
          info: {
            id: "a2",
            sessionID: "sess-1",
            role: "assistant",
            providerID: "openai",
            modelID: "gpt-4.1",
            cost: 0.3,
            time: {
              completed: 200,
            },
            tokens: {
              input: 300,
              output: 120,
              reasoning: 30,
              cache: { read: 50, write: 0 },
            },
          } as any,
          parts: [],
        },
      ],
      [
        {
          tier: "advanced",
          provider: "openai",
          modelId: "gpt-4.1",
          label: "Advanced",
          providerLabel: "OpenAI",
          modelLabel: "GPT-4.1",
          contextLimit: 1_000,
          inputLimit: 800,
        },
      ],
    );

    expect(metrics.totalCost).toBe(0.5);
    expect(metrics.messageCount).toBe(3);
    expect(metrics.userMessageCount).toBe(1);
    expect(metrics.assistantMessageCount).toBe(2);
    expect(metrics.context).toEqual({
      messageId: "a2",
      providerId: "openai",
      modelId: "gpt-4.1",
      providerLabel: "OpenAI",
      modelLabel: "GPT-4.1",
      limit: 1_000,
      inputLimit: 800,
      workingLimit: 800,
      input: 300,
      output: 120,
      reasoning: 30,
      cacheRead: 50,
      cacheWrite: 0,
      total: 500,
      usage: 63,
      completedAt: 200,
    });
  });

  it("uses a provided soft limit when model metadata is unavailable", () => {
    const metrics = getSessionContextMetrics([
      {
        info: {
          id: "a1",
          sessionID: "sess-1",
          role: "assistant",
          providerId: "openrouter",
          modelId: "google/gemini-flash",
          cost: 0,
          tokens: {
            input: 90_000,
            output: 10_000,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        } as any,
        parts: [],
      },
    ], [], {
      softContextLimitTokens: 300_000,
    });

    expect(metrics.context).toEqual({
      messageId: "a1",
      providerId: "openrouter",
      modelId: "google/gemini-flash",
      providerLabel: "openrouter",
      modelLabel: "google/gemini-flash",
      limit: undefined,
      inputLimit: undefined,
      workingLimit: 300_000,
      input: 90_000,
      output: 10_000,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 100_000,
      usage: 33,
      completedAt: undefined,
    });
  });

  it("returns null context when no assistant token data exists", () => {
    const metrics = getSessionContextMetrics([
      {
        info: {
          id: "u1",
          sessionID: "sess-1",
          role: "user",
        } as any,
        parts: [],
      },
    ]);

    expect(metrics.context).toBeNull();
    expect(metrics.totalCost).toBe(0);
  });
});
