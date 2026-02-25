import type { Message } from "./chatTypes";
import { normalizeToolStatus } from "./chatStreamUtils";

type TimelineTurn = {
  runId: string;
  userMessage?: Message;
  agentMessage?: Message;
  previousUserTimestamp?: number;
};

export type TimelineFallbackState = "waiting" | "working" | null;

export type ChatTimelineItem =
  | {
      kind: "user";
      key: string;
      runId: string;
      message: Message;
      previousUserTimestamp?: number;
    }
  | {
      kind: "agent";
      key: string;
      runId: string;
      message?: Message;
      orderedParts: any[];
      actionParts: any[];
      responseParts: any[];
      hasInterleavedParts: boolean;
      runInProgress: boolean;
      showWorkedSection: boolean;
      workedLabel?: string;
      fallbackState: TimelineFallbackState;
    };

export type ChatTimelineModel = {
  items: ChatTimelineItem[];
};

type BuildChatTimelineModelArgs = {
  messages: Message[];
  liveParts: any[];
  isWorking: boolean;
  isWaiting: boolean;
};

function extractRenderableParts(parts: any[] | undefined): any[] {
  if (!parts || parts.length === 0) return [];
  return parts.filter((part) =>
    part?.type === "reasoning" || part?.type === "tool" || part?.type === "text",
  );
}

function extractActionParts(parts: any[] | undefined): any[] {
  if (!parts || parts.length === 0) return [];
  return parts.filter((part) => part?.type === "reasoning" || part?.type === "tool");
}

function extractResponseParts(parts: any[] | undefined): any[] {
  if (!parts || parts.length === 0) return [];
  return parts.filter((part) => part?.type === "text");
}

function hasRenderableResponsePart(parts: any[] | undefined): boolean {
  return extractResponseParts(parts).some((part) => {
    const text = typeof part?.text === "string" ? part.text : "";
    return text.trim().length > 0;
  });
}

function hasInterleavedActionAndText(parts: any[]): boolean {
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

function createTimelineTurns(messages: Message[]): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  let openTurn: TimelineTurn | null = null;
  let mostRecentUserTimestamp: number | undefined;

  messages.forEach((message) => {
    const nextRunId = `turn-${turns.length}`;

    if (message.role === "user") {
      const turn: TimelineTurn = {
        runId: nextRunId,
        userMessage: message,
        previousUserTimestamp: message.createdAt ?? mostRecentUserTimestamp,
      };
      turns.push(turn);
      openTurn = turn;
      if (message.createdAt) {
        mostRecentUserTimestamp = message.createdAt;
      }
      return;
    }

    if (openTurn && !openTurn.agentMessage) {
      openTurn.agentMessage = message;
      return;
    }

    turns.push({
      runId: nextRunId,
      agentMessage: message,
      previousUserTimestamp: mostRecentUserTimestamp,
    });
    openTurn = null;
  });

  return turns;
}

function deriveFallbackState(
  actionParts: any[],
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

export function buildChatTimelineModel({
  messages,
  liveParts,
  isWorking,
  isWaiting,
}: BuildChatTimelineModelArgs): ChatTimelineModel {
  const turns = createTimelineTurns(messages);

  let activeTurnIndex = -1;
  if (isWorking) {
    const lastTurn = turns[turns.length - 1];
    const hasPendingUserTurn =
      Boolean(lastTurn?.userMessage) && !lastTurn?.agentMessage;
    const hasLiveParts = liveParts.length > 0;
    const lastTurnMissingResponse =
      Boolean(lastTurn?.agentMessage) &&
      !hasRenderableResponsePart(lastTurn?.agentMessage?.parts) &&
      !hasRenderableResponsePart(liveParts);

    if (hasPendingUserTurn) {
      activeTurnIndex = turns.length - 1;
    } else if (hasLiveParts || lastTurnMissingResponse) {
      activeTurnIndex = turns.length - 1;
    } else {
      turns.push({ runId: `turn-${turns.length}` });
      activeTurnIndex = turns.length - 1;
    }
  }

  const items: ChatTimelineItem[] = [];

  turns.forEach((turn, index) => {
    if (turn.userMessage) {
      items.push({
        kind: "user",
        key: `${turn.runId}-user`,
        runId: turn.runId,
        message: turn.userMessage,
        previousUserTimestamp: turn.previousUserTimestamp,
      });
    }

    const isActiveTurn = isWorking && index === activeTurnIndex;
    const baseOrderedParts = extractRenderableParts(turn.agentMessage?.parts);
    const orderedParts = isActiveTurn
      ? mergeLiveParts(baseOrderedParts, liveParts)
      : baseOrderedParts;
    const actionParts = extractActionParts(orderedParts);
    const responseParts = extractResponseParts(orderedParts);
    const shouldRenderAgentRow = Boolean(turn.agentMessage) || isActiveTurn;

    if (!shouldRenderAgentRow) {
      return;
    }

    const runInProgress = isActiveTurn;
    const hasInterleavedParts = hasInterleavedActionAndText(orderedParts);
    const showWorkedSection =
      !runInProgress &&
      actionParts.length > 0 &&
      responseParts.length > 0 &&
      !hasInterleavedParts;

    items.push({
      kind: "agent",
      key: `${turn.runId}-agent`,
      runId: turn.runId,
      message: turn.agentMessage,
      orderedParts,
      actionParts,
      responseParts,
      hasInterleavedParts,
      runInProgress,
      showWorkedSection,
      workedLabel: showWorkedSection
        ? formatWorkedLabel(
            turn.previousUserTimestamp,
            turn.agentMessage?.createdAt,
          )
        : undefined,
      fallbackState: runInProgress
        ? deriveFallbackState(actionParts, isWaiting)
        : null,
    });
  });

  return { items };
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

export function mergeLiveParts(prev: any[], incoming: any[]): any[] {
  if (incoming.length === 0) return prev;
  if (prev.length === 0) return [...incoming];

  const next = [...prev];
  const indexById = new Map<string, number>();

  next.forEach((part, index) => {
    if (part?.id) {
      indexById.set(String(part.id), index);
    }
  });

  for (const part of incoming) {
    const partId = part?.id ? String(part.id) : undefined;
    if (partId && indexById.has(partId)) {
      const existingIndex = indexById.get(partId)!;
      next[existingIndex] = { ...next[existingIndex], ...part };
      continue;
    }

    if (partId) {
      indexById.set(partId, next.length);
      next.push(part);
      continue;
    }

    const existingAnonIndex = next.findIndex(
      (candidate) =>
        !candidate?.id &&
        candidate?.type === part?.type &&
        candidate?.tool === part?.tool &&
        candidate?.title === part?.title,
    );

    if (existingAnonIndex >= 0) {
      next[existingAnonIndex] = { ...next[existingAnonIndex], ...part };
      continue;
    }

    next.push(part);
  }

  return next;
}

// Backward-compatible alias while callers migrate.
export const mergeLiveActionParts = mergeLiveParts;
