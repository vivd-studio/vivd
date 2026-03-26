import type {
  OpenCodeChatState,
  OpenCodeOptimisticUserMessage,
  OpenCodeSessionMessageRecord,
} from "../types";
import { selectMessagesForSession } from "./selectors";

const OPTIMISTIC_MATCH_WINDOW_MS = 2 * 60 * 1000;
const VIVD_INTERNAL_TAG_REGEX = /<vivd-internal\s+[^>]*?\/>/g;

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

function normalizeMessageComparisonText(text: string): string {
  const stripped = text.replace(VIVD_INTERNAL_TAG_REGEX, " ").trim();
  const candidate = stripped || text;
  return candidate.replace(/\s+/g, " ").trim();
}

function getComparableMessageText(record: OpenCodeSessionMessageRecord): string {
  return normalizeMessageComparisonText(getMessageText(record));
}

function isOptimisticMessageId(messageId: string | undefined): boolean {
  return typeof messageId === "string" && messageId.startsWith("optimistic:");
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

    if (
      getComparableMessageText(record) !==
      normalizeMessageComparisonText(optimisticMessage.content)
    ) {
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

export function resolveCanonicalUserMessageId(
  messages: OpenCodeSessionMessageRecord[],
  messageId: string,
): string | null {
  if (!isOptimisticMessageId(messageId)) {
    return messageId;
  }

  const optimisticRecord = messages.find(
    (message) => message.info.id === messageId && message.info.role === "user",
  );
  if (!optimisticRecord) {
    return null;
  }

  const optimisticText = getComparableMessageText(optimisticRecord);
  const optimisticCreatedAt = normalizeOpenCodeTimestamp(
    optimisticRecord.info.time?.created,
  );

  const canonicalCandidates = messages.filter((message) => {
    const candidateId = message.info.id;
    if (
      message.info.role !== "user" ||
      !candidateId ||
      isOptimisticMessageId(candidateId)
    ) {
      return false;
    }

    if (getComparableMessageText(message) !== optimisticText) {
      return false;
    }

    if (optimisticCreatedAt == null) {
      return true;
    }

    const candidateCreatedAt = normalizeOpenCodeTimestamp(
      message.info.time?.created,
    );
    return (
      candidateCreatedAt == null ||
      Math.abs(candidateCreatedAt - optimisticCreatedAt) <=
        OPTIMISTIC_MATCH_WINDOW_MS
    );
  });

  if (canonicalCandidates.length === 0) {
    return null;
  }

  canonicalCandidates.sort((left, right) => {
    const leftTime = normalizeOpenCodeTimestamp(left.info.time?.created);
    const rightTime = normalizeOpenCodeTimestamp(right.info.time?.created);

    if (optimisticCreatedAt != null) {
      const leftDistance =
        leftTime == null
          ? Number.POSITIVE_INFINITY
          : Math.abs(leftTime - optimisticCreatedAt);
      const rightDistance =
        rightTime == null
          ? Number.POSITIVE_INFINITY
          : Math.abs(rightTime - optimisticCreatedAt);
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
    }

    return compareMessageRecords(left, right);
  });

  return canonicalCandidates[0]?.info.id ?? null;
}
