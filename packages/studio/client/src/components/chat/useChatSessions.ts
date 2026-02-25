import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { trpc } from "@/lib/trpc";
import {
  POLLING_IDLE,
  getActivePollingInterval,
  getSessionStatusPollingInterval,
} from "@/app/config/polling";
import type { Session } from "./chatTypes";

type UseChatSessionsArgs = {
  projectSlug: string;
  version?: number;
  isActive: boolean;
  autoSelectLockedRef: MutableRefObject<boolean>;
  hasAutoSelectedRunningSessionRef: MutableRefObject<boolean>;
};

export function useChatSessions({
  projectSlug,
  version,
  isActive,
  autoSelectLockedRef,
  hasAutoSelectedRunningSessionRef,
}: UseChatSessionsArgs) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [isSessionHydrating, setIsSessionHydrating] = useState(false);
  const bootstrapSessionsPollUntilRef = useRef(Date.now() + 60_000);

  const selectSession = useCallback(
    (sessionId: string | null) => {
      autoSelectLockedRef.current = true;
      setSelectedSessionId(sessionId);
    },
    [autoSelectLockedRef],
  );

  // On studio boot, OpenCode data hydration can lag the initial UI render.
  // Poll sessions for a short window so existing sessions appear without requiring user interaction.
  useEffect(() => {
    bootstrapSessionsPollUntilRef.current = Date.now() + 60_000;
  }, [projectSlug, version]);

  // Poll for sessions to keep the list and status updated
  const {
    data: sessionsData,
    refetch: refetchSessions,
    isLoading: sessionsLoading,
  } = trpc.agent.listSessions.useQuery(
    { projectSlug, version },
    {
      refetchOnMount: true,
      refetchInterval: (query) => {
        const activeInterval = getActivePollingInterval(isActive);
        if (activeInterval) return activeInterval;

        const sessionsCount = query.state.data?.length ?? 0;
        const shouldBootstrapPoll =
          sessionsCount === 0 &&
          Date.now() < bootstrapSessionsPollUntilRef.current;

        return shouldBootstrapPoll ? POLLING_IDLE : false;
      },
    },
  );

  useEffect(() => {
    if (sessionsData) {
      setSessions(sessionsData);
    }
  }, [sessionsData]);

  // Poll for session statuses - this is the source of truth for whether a session is active
  const { data: sessionStatuses } = trpc.agent.getSessionsStatus.useQuery(
    { projectSlug, version },
    {
      refetchInterval: getSessionStatusPollingInterval(isActive),
    },
  );

  // Get current session's status from polled data
  const currentSessionStatus = selectedSessionId
    ? sessionStatuses?.[selectedSessionId]
    : undefined;

  useEffect(() => {
    if (
      selectedSessionId ||
      autoSelectLockedRef.current ||
      hasAutoSelectedRunningSessionRef.current
    ) {
      return;
    }

    if (!sessionStatuses || sessions.length === 0) {
      return;
    }

    const activeSessions = sessions.filter((session) => {
      const status = sessionStatuses?.[session.id];
      return status?.type === "busy" || status?.type === "retry";
    });

    if (activeSessions.length === 0) {
      return;
    }

    const getSessionTimestamp = (session: Session) =>
      session.time?.updated ?? session.time?.created ?? 0;
    const mostRecentSession = activeSessions.reduce((latest, session) => {
      return getSessionTimestamp(session) > getSessionTimestamp(latest)
        ? session
        : latest;
    }, activeSessions[0]);

    hasAutoSelectedRunningSessionRef.current = true;
    setSelectedSessionId(mostRecentSession.id);
  }, [
    selectedSessionId,
    sessionStatuses,
    sessions,
    autoSelectLockedRef,
    hasAutoSelectedRunningSessionRef,
  ]);

  // Poll for messages of the selected session
  const {
    data: sessionMessages,
    refetch: refetchMessages,
    isError: sessionMessagesIsError,
    error: sessionMessagesError,
  } = trpc.agent.getSessionContent.useQuery(
    {
      sessionId: selectedSessionId!,
      projectSlug,
      version,
    },
    {
      enabled: !!selectedSessionId,
      // Poll when active as a recovery mechanism in case SSE events are missed
      refetchInterval: getActivePollingInterval(isActive),
    },
  );

  // Force refetch messages when switching to a session
  // This ensures we get fresh data even if the session completed while we were away
  useEffect(() => {
    if (selectedSessionId) {
      refetchMessages();
    }
  }, [selectedSessionId, refetchMessages]);

  const shouldSubscribeToSessionEvents =
    !!selectedSessionId &&
    (isActive ||
      currentSessionStatus?.type === "busy" ||
      currentSessionStatus?.type === "retry");

  return {
    sessions,
    sessionsLoading,
    selectedSessionId,
    setSelectedSessionId,
    selectSession,
    isSessionHydrating,
    setIsSessionHydrating,
    sessionMessages,
    sessionMessagesIsError,
    sessionMessagesError,
    refetchMessages,
    refetchSessions,
    currentSessionStatus,
    shouldSubscribeToSessionEvents,
  };
}
