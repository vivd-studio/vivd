import { normalizeMessagePart } from "./chatStreamUtils";
import type { Message, UsageData } from "./chatTypes";

type MapSessionMessagesOptions = {
  sessionStatusType?: string | null;
};

const TERMINAL_SESSION_STATUS_TYPES = new Set(["idle", "done", "error"]);
const INTERRUPTED_CONTINUE_MIN_AGE_MS = 10_000;
const STALE_TERMINAL_WAIT_GRACE_MS = 15_000;
const STALE_HYDRATION_DEFERRAL_MS = 15_000;

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

function finalizeInterruptedToolParts(
  messages: Message[],
  sessionStatusType?: string | null,
): Message[] {
  if (!TERMINAL_SESSION_STATUS_TYPES.has(sessionStatusType ?? "")) {
    return messages;
  }

  return messages.map((message) => {
    if (message.role !== "agent" || !message.parts || message.parts.length === 0) {
      return message;
    }

    const hasRenderableText = message.parts.some((part: any) => {
      if (part?.type !== "text") return false;
      const text = typeof part?.text === "string" ? part.text : "";
      return text.trim().length > 0;
    });

    let changed = false;
    const nextParts = message.parts.map((part: any) => {
      if (part?.type !== "tool" || part?.status !== "running") {
        return part;
      }

      changed = true;
      if (hasRenderableText) {
        return { ...part, status: "completed", error: undefined };
      }

      return {
        ...part,
        status: "error",
        error: part.error ?? "Tool execution interrupted before completion.",
      };
    });

    if (!changed) return message;
    return { ...message, parts: nextParts };
  });
}

export function mapSessionMessagesToChatMessages(
  sessionMessages: any[],
  options: MapSessionMessagesOptions = {},
): Message[] {
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

  const mergedMessages = mergeAgentMessages(normalizedMessages);
  return finalizeInterruptedToolParts(
    mergedMessages,
    options.sessionStatusType,
  );
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

export function hasFinalAgentResponse(messages: Message[]): boolean {
  if (messages.length === 0) {
    return false;
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "agent") {
    return false;
  }

  if (lastMessage.content.trim().length > 0) {
    return true;
  }

  return (lastMessage.parts ?? []).some((part: any) => {
    if (part?.type !== "text") {
      return false;
    }
    const text = typeof part?.text === "string" ? part.text : "";
    return text.trim().length > 0;
  });
}

export function shouldSuggestInterruptedContinue(options: {
  sessionStatus: string | null | undefined;
  messages: Message[];
  isThinking: boolean;
  isLoading: boolean;
  now?: number;
  minAgeMs?: number;
}): boolean {
  const isTerminalStatus =
    options.sessionStatus === "done" || options.sessionStatus === "idle";

  if (!isTerminalStatus) {
    return false;
  }

  if (options.isThinking || options.isLoading) {
    return false;
  }

  if (options.messages.length === 0) {
    return false;
  }

  const lastUserMessage = [...options.messages]
    .reverse()
    .find((message) => message.role === "user");
  if (
    lastUserMessage &&
    lastUserMessage.content.trim().toLowerCase() === "continue"
  ) {
    return false;
  }

  const lastUserCreatedAt = lastUserMessage?.createdAt;
  if (
    lastUserCreatedAt &&
    (options.now ?? Date.now()) - lastUserCreatedAt <
      (options.minAgeMs ?? INTERRUPTED_CONTINUE_MIN_AGE_MS)
  ) {
    return false;
  }

  return !hasFinalAgentResponse(options.messages);
}

export function shouldHoldWaitingForStaleTerminalStatus(options: {
  sessionStatus: string | null | undefined;
  isWaitingForAgent: boolean;
  lastUserMessageAt?: number;
  pendingRunStartedAt?: number | null;
  now?: number;
  graceMs?: number;
}): boolean {
  if (!options.isWaitingForAgent) {
    return false;
  }

  const status = options.sessionStatus;
  if (status !== "idle" && status !== "done") {
    return false;
  }

  const mostRecentRunSignalAt = Math.max(
    options.lastUserMessageAt ?? 0,
    options.pendingRunStartedAt ?? 0,
  );

  if (!mostRecentRunSignalAt) {
    return false;
  }

  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? STALE_TERMINAL_WAIT_GRACE_MS;
  return now - mostRecentRunSignalAt < graceMs;
}

export function shouldDeferSessionHydrationWhilePendingRun(options: {
  isWaitingForAgent: boolean;
  pendingRunStartedAt?: number | null;
  currentMessages: Message[];
  incomingMessages: Message[];
  now?: number;
  maxDeferralMs?: number;
}): boolean {
  if (!options.isWaitingForAgent) {
    return false;
  }

  const pendingRunStartedAt = options.pendingRunStartedAt ?? 0;
  if (!pendingRunStartedAt) {
    return false;
  }

  const now = options.now ?? Date.now();
  const maxDeferralMs = options.maxDeferralMs ?? STALE_HYDRATION_DEFERRAL_MS;
  if (now - pendingRunStartedAt >= maxDeferralMs) {
    return false;
  }

  const localLastMessage =
    options.currentMessages[options.currentMessages.length - 1];
  if (!localLastMessage || localLastMessage.role !== "user") {
    return false;
  }

  const localLastUserCreatedAt = localLastMessage.createdAt ?? 0;
  if (localLastUserCreatedAt < pendingRunStartedAt) {
    return false;
  }

  return options.incomingMessages.length < options.currentMessages.length;
}
