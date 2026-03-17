import type {
  OpenCodeChatState,
  OpenCodeOptimisticUserMessage,
  OpenCodeSessionMessageRecord,
} from "../types";
import { selectMessagesForSession } from "./selectors";

const OPTIMISTIC_MATCH_WINDOW_MS = 2 * 60 * 1000;

export function normalizeOpenCodeTimestamp(value: unknown): number | null {
  if (value == null) return null;

  const toMillis = (n: number) => (n < 1_000_000_000_000 ? n * 1000 : n);

  if (typeof value === "number" && Number.isFinite(value)) {
    return toMillis(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return toMillis(asNumber);
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function compareMessageRecords(
  left: OpenCodeSessionMessageRecord,
  right: OpenCodeSessionMessageRecord,
): number {
  const leftTime =
    normalizeOpenCodeTimestamp(left.info.time?.created) ??
    normalizeOpenCodeTimestamp(left.info.time?.updated) ??
    0;
  const rightTime =
    normalizeOpenCodeTimestamp(right.info.time?.created) ??
    normalizeOpenCodeTimestamp(right.info.time?.updated) ??
    0;

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.info.id.localeCompare(right.info.id);
}

function getMessageText(record: OpenCodeSessionMessageRecord): string {
  return (record.parts ?? [])
    .filter((part) => part?.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

export function createOptimisticUserMessageRecord(
  message: OpenCodeOptimisticUserMessage,
): OpenCodeSessionMessageRecord {
  return {
    info: {
      id: `optimistic:${message.clientId}`,
      sessionID: message.sessionId ?? "__optimistic__",
      role: "user",
      time: {
        created: message.createdAt,
      },
    },
    parts: [
      {
        id: `optimistic:${message.clientId}:text`,
        messageID: `optimistic:${message.clientId}`,
        sessionID: message.sessionId ?? "__optimistic__",
        type: "text",
        text: message.content,
      },
    ],
  };
}

export function hasCanonicalMatchForOptimisticMessage(
  state: OpenCodeChatState,
  optimisticMessage: OpenCodeOptimisticUserMessage,
): boolean {
  if (!optimisticMessage.sessionId) {
    return false;
  }

  const canonicalMessages = selectMessagesForSession(state, optimisticMessage.sessionId).map(
    (message) => ({
      info: message,
      parts: message.parts,
    }),
  );

  return canonicalMessages.some((record) => {
    if (record.info.role !== "user") {
      return false;
    }

    if (getMessageText(record) !== optimisticMessage.content.trim()) {
      return false;
    }

    const createdAt = normalizeOpenCodeTimestamp(record.info.time?.created);
    return (
      createdAt == null ||
      Math.abs(createdAt - optimisticMessage.createdAt) <=
        OPTIMISTIC_MATCH_WINDOW_MS
    );
  });
}

function isRelevantOptimisticMessage(
  optimisticMessage: OpenCodeOptimisticUserMessage,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) {
    return optimisticMessage.sessionId == null;
  }

  return optimisticMessage.sessionId === sessionId;
}

export function selectMergedSessionMessages(args: {
  state: OpenCodeChatState;
  sessionId: string | null | undefined;
  optimisticUserMessages: OpenCodeOptimisticUserMessage[];
}): OpenCodeSessionMessageRecord[] {
  const canonicalMessages = selectMessagesForSession(args.state, args.sessionId).map(
    (message) => ({
      info: message,
      parts: message.parts,
    }),
  );

  const unmatchedOptimisticMessages = args.optimisticUserMessages
    .filter((message) => isRelevantOptimisticMessage(message, args.sessionId))
    .filter((message) => !hasCanonicalMatchForOptimisticMessage(args.state, message))
    .map(createOptimisticUserMessageRecord);

  if (unmatchedOptimisticMessages.length === 0) {
    return canonicalMessages;
  }

  return [...canonicalMessages, ...unmatchedOptimisticMessages].sort(
    compareMessageRecords,
  );
}
