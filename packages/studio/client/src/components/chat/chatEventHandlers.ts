import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  normalizeErrorMessage,
  upsertDeltaStreamingPart,
  upsertToolStartedPart,
  updateToolPartStatus,
} from "./chatStreamUtils";
import type { SessionError, UsageData } from "./chatTypes";

type SessionEventKind = {
  kind: string;
  [key: string]: unknown;
};

type SessionEventHandlerArgs = {
  eventData: SessionEventKind;
  setStreamingParts: Dispatch<SetStateAction<any[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setIsWaiting: Dispatch<SetStateAction<boolean>>;
  isWaitingForAgent: MutableRefObject<boolean>;
  setSessionError: Dispatch<SetStateAction<SessionError | null>>;
  refetchMessages: () => void;
  refetchUsageStatus: () => void;
  setUsage: Dispatch<SetStateAction<UsageData | null>>;
  onTaskComplete?: () => void;
};

export function handleSessionEvent({
  eventData,
  setStreamingParts,
  setIsStreaming,
  setIsWaiting,
  isWaitingForAgent,
  setSessionError,
  refetchMessages,
  refetchUsageStatus,
  setUsage,
  onTaskComplete,
}: SessionEventHandlerArgs) {
  switch (eventData.kind) {
    case "thinking.started":
      setStreamingParts([]);
      setIsStreaming(false);
      setIsWaiting(true);
      return;

    case "reasoning.delta":
    case "message.delta": {
      setIsStreaming(true);
      setIsWaiting(false);
      if ("content" in eventData && "partId" in eventData) {
        const partId = eventData.partId as string;
        const content = eventData.content as string;
        const partType =
          eventData.kind === "reasoning.delta" ? "reasoning" : "text";

        setStreamingParts((prev) =>
          upsertDeltaStreamingPart(prev, partId, partType, content),
        );
      }
      return;
    }

    case "tool.started":
      if ("toolId" in eventData && "tool" in eventData) {
        setIsStreaming(true);
        setIsWaiting(false);
        const toolId = eventData.toolId as string;
        const tool = eventData.tool as string;
        const title =
          "title" in eventData ? (eventData.title as string) : undefined;

        setStreamingParts((prev) => upsertToolStartedPart(prev, toolId, tool, title));
      }
      return;

    case "tool.completed":
      if ("toolId" in eventData) {
        const toolId = eventData.toolId as string;
        setStreamingParts((prev) =>
          updateToolPartStatus(prev, toolId, "completed"),
        );
      }
      return;

    case "tool.error":
      if ("toolId" in eventData) {
        const toolId = eventData.toolId as string;
        const errorMessage = normalizeErrorMessage(
          "error" in eventData ? eventData.error : undefined,
        );
        setStreamingParts((prev) =>
          updateToolPartStatus(prev, toolId, "error", errorMessage),
        );
      }
      return;

    case "session.completed":
      setIsStreaming(false);
      setStreamingParts([]);
      isWaitingForAgent.current = false;
      setIsWaiting(false);
      setSessionError(null);
      refetchMessages();
      refetchUsageStatus();
      onTaskComplete?.();
      return;

    case "session.error":
      if ("errorType" in eventData && "message" in eventData) {
        setSessionError({
          type: eventData.errorType as string,
          message: eventData.message as string,
          attempt: (eventData as any).attempt,
          nextRetryAt: (eventData as any).nextRetryAt,
        });
        setIsWaiting(false);
        setIsStreaming(false);
        setStreamingParts([]);
        isWaitingForAgent.current = false;
      }
      return;

    case "usage.updated":
      if ("cost" in eventData && "tokens" in eventData) {
        setUsage((prev) => {
          const prevCost = prev?.cost || 0;
          const prevTokens = prev?.tokens || {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          };

          return {
            cost: prevCost + (eventData.cost as number),
            tokens: {
              input: prevTokens.input + (eventData.tokens as any).input,
              output: prevTokens.output + (eventData.tokens as any).output,
              reasoning:
                prevTokens.reasoning +
                ((eventData.tokens as any).reasoning || 0),
              cache: {
                read:
                  prevTokens.cache.read +
                  ((eventData.tokens as any).cache?.read || 0),
                write:
                  prevTokens.cache.write +
                  ((eventData.tokens as any).cache?.write || 0),
              },
            },
          };
        });
      }
      return;
  }
}

type SessionStreamErrorHandlerArgs = {
  error: unknown;
  setSseConnected: Dispatch<SetStateAction<boolean>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setIsWaiting: Dispatch<SetStateAction<boolean>>;
  isWaitingForAgent: MutableRefObject<boolean>;
  setSessionError: Dispatch<SetStateAction<SessionError | null>>;
  refetchMessages: () => void;
  refetchSessions: () => void;
};

export function handleSessionStreamError({
  error,
  setSseConnected,
  setIsStreaming,
  setIsWaiting,
  isWaitingForAgent,
  setSessionError,
  refetchMessages,
  refetchSessions,
}: SessionStreamErrorHandlerArgs) {
  setSseConnected(false);
  setIsStreaming(false);
  setIsWaiting(false);
  isWaitingForAgent.current = false;
  setSessionError({
    type: "stream",
    message:
      normalizeErrorMessage((error as any)?.message ?? error) ||
      "Live updates disconnected",
  });
  refetchMessages();
  refetchSessions();
}
