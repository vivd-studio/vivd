import type { UsageData } from "../../../components/chat/chatTypes";
import type { OpenCodeSessionMessageRecord } from "../types";

export function calculateUsageFromSessionMessages(
  sessionMessages: OpenCodeSessionMessageRecord[],
): UsageData | null {
  let totalCost = 0;
  const totalTokens = {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  };

  sessionMessages.forEach((record) => {
    const info = record.info;
    if (info?.role !== "assistant" || !("cost" in info) || !info.cost) {
      return;
    }

    totalCost += Number(info.cost) || 0;
    const tokens = "tokens" in info ? info.tokens : undefined;
    if (!tokens || typeof tokens !== "object") {
      return;
    }

    totalTokens.input += Number((tokens as any).input) || 0;
    totalTokens.output += Number((tokens as any).output) || 0;
    totalTokens.reasoning += Number((tokens as any).reasoning) || 0;

    const cache = (tokens as any).cache;
    if (cache && typeof cache === "object") {
      totalTokens.cache.read += Number(cache.read) || 0;
      totalTokens.cache.write += Number(cache.write) || 0;
    }
  });

  if (totalCost <= 0) {
    return null;
  }

  return {
    cost: totalCost,
    tokens: totalTokens,
  };
}
