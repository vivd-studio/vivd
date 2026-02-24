import { normalizeMessagePart } from "./chatStreamUtils";
import type { Message, UsageData } from "./chatTypes";

function normalizeTimestamp(value: unknown): number | undefined {
  if (value == null) return undefined;

  const toMillis = (n: number) => (n < 1_000_000_000_000 ? n * 1000 : n);

  if (typeof value === "number" && Number.isFinite(value)) {
    return toMillis(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return toMillis(asNumber);
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function mergeAgentMessages(messages: Message[]): Message[] {
  const merged: Message[] = [];

  for (const message of messages) {
    const previous = merged[merged.length - 1];

    if (message.role === "agent" && previous?.role === "agent") {
      const mergedContent = [previous.content, message.content]
        .filter((segment) => segment && segment.trim().length > 0)
        .join("\n")
        .trim();

      merged[merged.length - 1] = {
        ...previous,
        id: message.id ?? previous.id,
        content: mergedContent,
        parts: [...(previous.parts ?? []), ...(message.parts ?? [])],
        createdAt: message.createdAt ?? previous.createdAt,
      };
      continue;
    }

    merged.push(message);
  }

  return merged;
}

export function mapSessionMessagesToChatMessages(sessionMessages: any[]): Message[] {
  const normalizedMessages = sessionMessages.map((msg: any) => {
    const role = msg.info?.role === "assistant" ? "agent" : "user";
    const normalizedParts = (msg.parts ?? [])
      .map(normalizeMessagePart)
      .filter(Boolean);
    const textContent =
      normalizedParts
      ?.filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("\n") || "";
    const createdAt = normalizeTimestamp(msg.info?.time?.created);

    return {
      id: msg.info?.id,
      role,
      content: textContent,
      parts: normalizedParts,
      ...(createdAt != null ? { createdAt } : {}),
    };
  });

  return mergeAgentMessages(normalizedMessages);
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
