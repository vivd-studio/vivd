import { useMemo } from "react";
import { useOptionalOpencodeChat } from "./provider";
import { selectSessionActivitySummary } from "./runtime";
import type { OpenCodeSessionActivitySummary } from "./types";

const EMPTY_SESSION_ACTIVITY_SUMMARY: OpenCodeSessionActivitySummary = {
  selectedSessionId: null,
  activeSessionIds: [],
  selectedSessionIsActive: false,
  otherActiveSessionIds: [],
  otherActiveSessionCount: 0,
  hasAnyActiveSession: false,
  hasOtherActiveSessions: false,
};

export function useOpencodeSessionActivity(): OpenCodeSessionActivitySummary {
  const context = useOptionalOpencodeChat();

  return useMemo(() => {
    if (!context) {
      return EMPTY_SESSION_ACTIVITY_SUMMARY;
    }

    return selectSessionActivitySummary({
      sessions: context.sessions,
      sessionStatusById: context.state.sessionStatusById,
      messagesById: context.state.messagesById,
      messagesBySessionId: context.state.messagesBySessionId,
      selectedSessionId: context.selectedSessionId,
    });
  }, [
    context?.selectedSessionId,
    context?.sessions,
    context?.state.messagesById,
    context?.state.messagesBySessionId,
    context?.state.sessionStatusById,
  ]);
}
