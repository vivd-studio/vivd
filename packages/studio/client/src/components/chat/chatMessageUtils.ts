import { normalizeMessagePart } from "./chatStreamUtils";
import type { Message, UsageData } from "./chatTypes";

export function mapSessionMessagesToChatMessages(sessionMessages: any[]): Message[] {
  return sessionMessages.map((msg: any) => {
    const role = msg.info?.role === "assistant" ? "agent" : "user";
    const normalizedParts = (msg.parts ?? [])
      .map(normalizeMessagePart)
      .filter(Boolean);
    const textContent =
      normalizedParts
        ?.filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("\n") || "";

    return {
      id: msg.info?.id,
      role,
      content: textContent,
      parts: normalizedParts,
    };
  });
}

export function calculateUsageFromSessionMessages(
  sessionMessages: any[],
): UsageData | null {
  let totalCost = 0;
  const totalTokens = {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  };

  sessionMessages.forEach((msg: any) => {
    const info = msg.info || msg;
    if (info && info.role === "assistant" && info.cost) {
      totalCost += info.cost || 0;
      if (info.tokens) {
        totalTokens.input += info.tokens.input || 0;
        totalTokens.output += info.tokens.output || 0;
        totalTokens.reasoning += info.tokens.reasoning || 0;
        if (info.tokens.cache) {
          totalTokens.cache.read += info.tokens.cache.read || 0;
          totalTokens.cache.write += info.tokens.cache.write || 0;
        }
      }
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

export function shouldRecoverFromMissedStreamEvents(
  mappedMessages: Message[],
  currentMessages: Message[],
): boolean {
  if (mappedMessages.length === 0) {
    return false;
  }

  const lastFetchedMessage = mappedMessages[mappedMessages.length - 1];
  const lastLocalMessage = currentMessages[currentMessages.length - 1];

  const serverHasAgentResponse =
    lastFetchedMessage.role === "agent" && Boolean(lastFetchedMessage.content);
  const localEndsWithUser = lastLocalMessage?.role === "user";
  const fetchedMessageCountHigher = mappedMessages.length > currentMessages.length;

  return (
    serverHasAgentResponse && (localEndsWithUser || fetchedMessageCountHigher)
  );
}
