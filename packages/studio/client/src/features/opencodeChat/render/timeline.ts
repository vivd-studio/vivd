import {
  normalizeMessagePart,
  normalizeToolStatus,
} from "../../../components/chat/chatStreamUtils";
import {
  hasPendingAssistantMessage,
  isTerminalSessionStatusType,
} from "../runtime";
import type {
  OpenCodeSessionMessageRecord,
  OpenCodeSessionStatus,
} from "../types";
import { normalizeOpenCodeTimestamp } from "../sync/optimisticMessages";

export type RenderableChatPart = any;

export type RenderableChatMessage = {
  id?: string;
  parentId?: string | null;
  role: "user" | "agent";
  content: string;
  parts: RenderableChatPart[];
  createdAt?: number;
  completedAt?: number;
};

type TimelineTurn = {
  runId: string;
  userMessage?: RenderableChatMessage;
  agentMessages: RenderableChatMessage[];
};

export type TimelineFallbackState = "waiting" | "working" | null;

export type CanonicalTimelineItem =
  | {
      kind: "user";
      key: string;
      runId: string;
      message: RenderableChatMessage;
      previousUserTimestamp?: number;
    }
  | {
      kind: "agent";
      key: string;
      runId: string;
      message?: RenderableChatMessage;
      orderedParts: RenderableChatPart[];
      actionParts: RenderableChatPart[];
      responseParts: RenderableChatPart[];
      hasInterleavedParts: boolean;
      runInProgress: boolean;
      showWorkedSection: boolean;
      workedLabel?: string;
      fallbackState: TimelineFallbackState;
    };

export type CanonicalTimelineModel = {
  items: CanonicalTimelineItem[];
};

type BuildCanonicalTimelineModelArgs = {
  messages: OpenCodeSessionMessageRecord[];
  sessionStatus: OpenCodeSessionStatus | null;
  isThinking: boolean;
  isWaiting: boolean;
};

function extractRenderableParts(parts: RenderableChatPart[]): RenderableChatPart[] {
  return parts.filter((part) =>
    part?.type === "reasoning" || part?.type === "tool" || part?.type === "text",
  );
}

function extractActionParts(parts: RenderableChatPart[]): RenderableChatPart[] {
  return parts.filter((part) => part?.type === "reasoning" || part?.type === "tool");
}

function extractResponseParts(parts: RenderableChatPart[]): RenderableChatPart[] {
  return parts.filter((part) => part?.type === "text");
}

function hasRenderableResponsePart(parts: RenderableChatPart[]): boolean {
  return extractResponseParts(parts).some((part) => {
    const text = typeof part?.text === "string" ? part.text : "";
    return text.trim().length > 0;
  });
}

function hasInterleavedActionAndText(parts: RenderableChatPart[]): boolean {
  let seenText = false;

  for (const part of parts) {
    if (part?.type === "text") {
      const text = typeof part?.text === "string" ? part.text : "";
      if (text.trim().length > 0) {
        seenText = true;
      }
      continue;
    }

    if ((part?.type === "reasoning" || part?.type === "tool") && seenText) {
      return true;
    }
  }

  return false;
}

function finalizeInterruptedToolParts(
  parts: RenderableChatPart[],
  shouldFinalize: boolean,
): RenderableChatPart[] {
  if (!shouldFinalize) {
    return parts;
  }

  const hasRenderableText = parts.some((part) => {
    if (part?.type !== "text") return false;
    const text = typeof part?.text === "string" ? part.text : "";
    return text.trim().length > 0;
  });

  let changed = false;
  const nextParts = parts.map((part) => {
    if (part?.type !== "tool" || normalizeToolStatus(part) !== "running") {
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

  return changed ? nextParts : parts;
}

function normalizeRecordToRenderableMessage(
  record: OpenCodeSessionMessageRecord,
  options?: {
    sessionStatusType?: string | null;
    finalizeInterruptedTools?: boolean;
  },
): RenderableChatMessage {
  const role = record.info?.role === "assistant" ? "agent" : "user";
  const renderableParts = extractRenderableParts(
    (record.parts ?? []).map(normalizeMessagePart).filter(Boolean),
  );
  const normalizedParts =
    role === "agent"
      ? finalizeInterruptedToolParts(
          renderableParts,
          Boolean(options?.finalizeInterruptedTools),
        )
      : renderableParts;
  const content = normalizedParts
    .filter((part) => part?.type === "text")
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n");
  const createdAt = normalizeOpenCodeTimestamp(record.info?.time?.created);
  const completedAt = normalizeOpenCodeTimestamp(record.info?.time?.completed);

  return {
    id: record.info?.id,
    parentId: record.info?.parentID ?? null,
    role,
    content,
    parts: normalizedParts,
    ...(createdAt != null ? { createdAt } : {}),
    ...(completedAt != null ? { completedAt } : {}),
  };
}

function normalizeRecordsToRenderableMessages(
  messages: OpenCodeSessionMessageRecord[],
  sessionStatusType?: string | null,
): RenderableChatMessage[] {
  const finalizeInterruptedTools =
    isTerminalSessionStatusType(sessionStatusType) &&
    !hasPendingAssistantMessage(messages);

  return messages.map((record) =>
    normalizeRecordToRenderableMessage(record, {
      sessionStatusType,
      finalizeInterruptedTools,
    }),
  );
}

function createTimelineTurns(
  messages: RenderableChatMessage[],
): TimelineTurn[] {
  const userTurnsById = new Map<string, TimelineTurn>();
  messages.forEach((message, index) => {
    if (message.role !== "user" || !message.id) {
      return;
    }

    userTurnsById.set(message.id, {
      runId: `turn-${message.id ?? index}`,
      userMessage: message,
      agentMessages: [],
    });
  });

  const turns: TimelineTurn[] = [];
  let currentUserTurn: TimelineTurn | null = null;
  let openOrphanTurn: TimelineTurn | null = null;

  messages.forEach((message, index) => {
    if (message.role === "user") {
      const turn =
        (message.id ? userTurnsById.get(message.id) : undefined) ?? {
          runId: `turn-${message.id ?? index}`,
          userMessage: message,
          agentMessages: [],
        };
      turns.push(turn);
      currentUserTurn = turn;
      openOrphanTurn = null;
      return;
    }

    const parentTurn =
      message.parentId != null ? userTurnsById.get(message.parentId) : undefined;
    if (parentTurn) {
      parentTurn.agentMessages.push(message);
      openOrphanTurn = null;
      return;
    }

    if (currentUserTurn) {
      currentUserTurn.agentMessages.push(message);
      openOrphanTurn = null;
      return;
    }

    if (!openOrphanTurn) {
      openOrphanTurn = {
        runId: `orphan-${message.id ?? index}`,
        agentMessages: [message],
      };
      turns.push(openOrphanTurn);
      return;
    }

    openOrphanTurn.agentMessages.push(message);
  });

  return turns;
}

function flattenTurnParts(agentMessages: RenderableChatMessage[]): RenderableChatPart[] {
  return agentMessages.flatMap((message) => message.parts ?? []);
}

function getLatestAgentMessage(
  agentMessages: RenderableChatMessage[],
): RenderableChatMessage | undefined {
  return agentMessages[agentMessages.length - 1];
}

function getTurnCompletedAt(agentMessages: RenderableChatMessage[]): number | undefined {
  return agentMessages.reduce<number | undefined>((latest, message) => {
    const completedAt = message.completedAt ?? message.createdAt;
    if (completedAt == null) {
      return latest;
    }
    if (latest == null) {
      return completedAt;
    }
    return Math.max(latest, completedAt);
  }, undefined);
}

function getActiveTurnRunId(turns: TimelineTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const hasPendingAssistant = turn.agentMessages.some(
      (message) => message.completedAt == null,
    );
    if (hasPendingAssistant) {
      return turn.runId;
    }
  }

  return turns[turns.length - 1]?.runId ?? null;
}

function deriveFallbackState(
  actionParts: RenderableChatPart[],
  isWaiting: boolean,
): TimelineFallbackState {
  if (actionParts.length === 0) {
    return isWaiting ? "waiting" : "working";
  }

  const lastActionPart = actionParts[actionParts.length - 1];
  const hasActivePart =
    lastActionPart?.type === "reasoning" ||
    normalizeToolStatus(lastActionPart) === "running";

  if (!hasActivePart) {
    return "working";
  }

  return null;
}

export function buildCanonicalTimelineModel({
  messages,
  sessionStatus,
  isThinking,
  isWaiting,
}: BuildCanonicalTimelineModelArgs): CanonicalTimelineModel {
  const renderableMessages = normalizeRecordsToRenderableMessages(
    messages,
    sessionStatus?.type,
  );
  const turns = createTimelineTurns(renderableMessages);

  const activeTurnRunId = isThinking ? getActiveTurnRunId(turns) : null;
  if (isThinking && turns.length === 0) {
    turns.push({ runId: "turn-0", agentMessages: [] });
  }

  const items: CanonicalTimelineItem[] = [];

  turns.forEach((turn) => {
    if (turn.userMessage) {
      items.push({
        kind: "user",
        key: `${turn.runId}-user`,
        runId: turn.runId,
        message: turn.userMessage,
        previousUserTimestamp: turn.userMessage.createdAt,
      });
    }

    const isActiveTurn = isThinking && turn.runId === activeTurnRunId;
    const orderedParts = flattenTurnParts(turn.agentMessages);
    const actionParts = extractActionParts(orderedParts);
    const responseParts = extractResponseParts(orderedParts);
    const latestAgentMessage = getLatestAgentMessage(turn.agentMessages);
    const shouldRenderAgentRow = turn.agentMessages.length > 0 || isActiveTurn;

    if (!shouldRenderAgentRow) {
      return;
    }

    const runInProgress = isActiveTurn;
    const hasInterleavedParts = hasInterleavedActionAndText(orderedParts);
    const showWorkedSection =
      !runInProgress &&
      actionParts.length > 0 &&
      responseParts.length > 0;

    items.push({
      kind: "agent",
      key: `${turn.runId}-agent`,
      runId: turn.runId,
      message: latestAgentMessage,
      orderedParts,
      actionParts,
      responseParts,
      hasInterleavedParts,
      runInProgress,
      showWorkedSection,
      workedLabel: showWorkedSection
        ? formatWorkedLabel(
            turn.userMessage?.createdAt,
            getTurnCompletedAt(turn.agentMessages),
          )
        : undefined,
      fallbackState: runInProgress
        ? deriveFallbackState(actionParts, isWaiting)
        : null,
    });
  });

  return { items };
}

export function hasFinalAgentResponseFromRecords(
  messages: OpenCodeSessionMessageRecord[],
  sessionStatus: OpenCodeSessionStatus | null,
): boolean {
  if (messages.length === 0) {
    return false;
  }

  const renderableMessages = normalizeRecordsToRenderableMessages(
    messages,
    sessionStatus?.type,
  );
  const turns = createTimelineTurns(renderableMessages);

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const orderedParts = flattenTurnParts(turns[index].agentMessages);
    if (orderedParts.length === 0) {
      if (turns[index].userMessage) {
        return false;
      }
      continue;
    }

    return hasRenderableResponsePart(orderedParts);
  }

  return false;
}

export function shouldSuggestInterruptedContinueFromRecords(options: {
  sessionStatus: string | null | undefined;
  messages: OpenCodeSessionMessageRecord[];
  isThinking: boolean;
  isLoading: boolean;
  now?: number;
  minAgeMs?: number;
}): boolean {
  const isTerminalStatus = isTerminalSessionStatusType(options.sessionStatus);

  if (!isTerminalStatus) {
    return false;
  }

  if (options.isThinking || options.isLoading) {
    return false;
  }

  if (options.messages.length === 0) {
    return false;
  }

  if (hasPendingAssistantMessage(options.messages)) {
    return false;
  }

  const renderableMessages = normalizeRecordsToRenderableMessages(
    options.messages,
    options.sessionStatus,
  );
  const lastUserMessage = [...renderableMessages]
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
      (options.minAgeMs ?? 10_000)
  ) {
    return false;
  }

  return !hasFinalAgentResponseFromRecords(options.messages, {
    type: (options.sessionStatus as "idle" | "busy" | "done" | "retry") ?? "idle",
  });
}

export function formatWorkedLabel(
  startedAt?: number,
  completedAt?: number,
): string {
  if (!startedAt || !completedAt || completedAt <= startedAt) {
    return "Worked session";
  }

  const durationSec = Math.max(1, Math.round((completedAt - startedAt) / 1000));
  if (durationSec < 60) {
    return `Worked for ${durationSec}s`;
  }

  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  if (seconds === 0) {
    return `Worked for ${minutes}m`;
  }
  return `Worked for ${minutes}m ${seconds}s`;
}
