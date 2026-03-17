import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { openCodeChatReducer } from "./sync/event-reducer";
import { selectSessions, selectSessionStatus } from "./sync/selectors";
import {
  createSubscriptionBatcherState,
  drainSubscriptionEvents,
  getSubscriptionBatcherDelay,
  queueSubscriptionEvent,
} from "./sync/subscriptionBatcher";
import {
  hasCanonicalMatchForOptimisticMessage,
  selectMergedSessionMessages,
} from "./sync/optimisticMessages";
import type {
  CanonicalChatEvent,
  OpenCodeOptimisticUserMessage,
  OpenCodeChatState,
  OpenCodeQuestionRequest,
  OpenCodeSession,
  OpenCodeSessionMessageRecord,
  OpenCodeSessionStatus,
} from "./types";
import { OPEN_CODE_CHAT_INITIAL_STATE } from "./types";

type OpencodeChatContextValue = {
  state: OpenCodeChatState;
  sessions: OpenCodeSession[];
  questionRequestsBySessionId: Record<string, OpenCodeQuestionRequest[]>;
  selectedSessionId: string | null;
  setSelectedSessionId: (sessionId: string | null) => void;
  sessionStatus: OpenCodeSessionStatus | null;
  selectedMessages: OpenCodeSessionMessageRecord[];
  bootstrapLoading: boolean;
  selectedSessionLoading: boolean;
  selectedSessionIsError: boolean;
  selectedSessionError: unknown;
  refetchBootstrap: () => Promise<unknown>;
  refetchSelectedSessionMessages: () => Promise<unknown>;
  selectedHasOptimisticUserMessage: boolean;
  addOptimisticUserMessage: (options: {
    content: string;
    sessionId: string | null;
    createdAt?: number;
  }) => string;
  assignOptimisticUserMessageSession: (
    clientId: string,
    sessionId: string,
  ) => void;
  removeOptimisticUserMessage: (clientId: string) => void;
};

const OpencodeChatContext = createContext<OpencodeChatContextValue | null>(null);

export function useOpencodeChat() {
  const context = useContext(OpencodeChatContext);
  if (!context) {
    throw new Error("useOpencodeChat must be used within OpencodeChatProvider");
  }
  return context;
}

export function useOptionalOpencodeChat() {
  return useContext(OpencodeChatContext);
}

interface OpencodeChatProviderProps {
  children: ReactNode;
  projectSlug: string;
  version?: number;
}

export function OpencodeChatProvider({
  children,
  projectSlug,
  version,
}: OpencodeChatProviderProps) {
  const lastEventIdRef = useRef<string | null>(null);
  const subscriptionBatcherRef = useRef(createSubscriptionBatcherState());
  const flushTimerRef = useRef<number | null>(null);
  const lastFlushAtRef = useRef(0);
  const [state, dispatch] = useReducer(
    openCodeChatReducer,
    OPEN_CODE_CHAT_INITIAL_STATE,
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<
    OpenCodeOptimisticUserMessage[]
  >([]);
  const nextOptimisticMessageIdRef = useRef(0);

  const bootstrapQuery = trpc.agentChat.bootstrap.useQuery(
    {
      projectSlug,
      version,
      ...(selectedSessionId ? { sessionId: selectedSessionId } : {}),
    },
    {
      staleTime: 0,
    },
  );

  useEffect(() => {
    if (!bootstrapQuery.data) return;
    dispatch({
      type: "bootstrap.loaded",
      payload: bootstrapQuery.data,
    });
  }, [bootstrapQuery.data]);

  const sessionMessagesQuery = trpc.agentChat.sessionMessages.useQuery(
    {
      projectSlug,
      version,
      sessionId: selectedSessionId ?? "",
    },
    {
      enabled: Boolean(selectedSessionId),
      staleTime: 0,
    },
  );

  useEffect(() => {
    if (!selectedSessionId || !sessionMessagesQuery.data) return;
    dispatch({
      type: "session.messages.loaded",
      payload: {
        sessionId: selectedSessionId,
        messages: sessionMessagesQuery.data,
      },
    });
  }, [selectedSessionId, sessionMessagesQuery.data]);

  const addOptimisticUserMessage = useCallback(
    (options: { content: string; sessionId: string | null; createdAt?: number }) => {
      const clientId = `client-${Date.now()}-${nextOptimisticMessageIdRef.current}`;
      nextOptimisticMessageIdRef.current += 1;
      setOptimisticUserMessages((prev) => [
        ...prev,
        {
          clientId,
          sessionId: options.sessionId,
          content: options.content,
          createdAt: options.createdAt ?? Date.now(),
        },
      ]);
      return clientId;
    },
    [],
  );

  const assignOptimisticUserMessageSession = useCallback(
    (clientId: string, sessionId: string) => {
      setOptimisticUserMessages((prev) =>
        prev.map((message) =>
          message.clientId === clientId ? { ...message, sessionId } : message,
        ),
      );
    },
    [],
  );

  const removeOptimisticUserMessage = useCallback((clientId: string) => {
    setOptimisticUserMessages((prev) =>
      prev.filter((message) => message.clientId !== clientId),
    );
  }, []);

  useEffect(() => {
    setOptimisticUserMessages((prev) => {
      const next = prev.filter(
        (message) => !hasCanonicalMatchForOptimisticMessage(state, message),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [state]);

  const flushQueuedEvents = useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const { events } = drainSubscriptionEvents(subscriptionBatcherRef.current);
    if (events.length === 0) {
      return;
    }

    lastFlushAtRef.current = Date.now();
    dispatch({
      type: "events.receivedBatch",
      payload: events,
    });
  }, []);

  const scheduleQueuedEventsFlush = useCallback(() => {
    if (flushTimerRef.current != null) {
      return;
    }

    flushTimerRef.current = window.setTimeout(() => {
      flushQueuedEvents();
    }, getSubscriptionBatcherDelay(lastFlushAtRef.current));
  }, [flushQueuedEvents]);

  useEffect(
    () => () => {
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      drainSubscriptionEvents(subscriptionBatcherRef.current);
    },
    [],
  );

  trpc.agentChat.events.useSubscription(
    {
      projectSlug,
      version,
      ...(lastEventIdRef.current ? { lastEventId: lastEventIdRef.current } : {}),
    },
    {
      enabled: true,
      onStarted: () => {
        flushQueuedEvents();
        dispatch({
          type: "connection.updated",
          payload: {
            state: "connected",
          },
        });
      },
      onData: (trackedEvent) => {
        lastEventIdRef.current = trackedEvent.id;
        queueSubscriptionEvent(subscriptionBatcherRef.current, {
          ...(trackedEvent.data as CanonicalChatEvent),
          eventId: trackedEvent.id,
        });
        scheduleQueuedEventsFlush();
      },
      onError: (error) => {
        flushQueuedEvents();
        dispatch({
          type: "connection.updated",
          payload: {
            state: "error",
            message: error.message,
          },
        });
      },
    },
  );

  const value = useMemo<OpencodeChatContextValue>(() => {
    const selectedMessages = selectMergedSessionMessages({
      state,
      sessionId: selectedSessionId,
      optimisticUserMessages,
    });
    const selectedHasOptimisticUserMessage = optimisticUserMessages.some(
      (message) =>
        (selectedSessionId == null
          ? message.sessionId == null
          : message.sessionId === selectedSessionId) &&
        !hasCanonicalMatchForOptimisticMessage(state, message),
    );

    return {
      state,
      sessions: selectSessions(state),
      questionRequestsBySessionId: state.questionRequestsBySessionId,
      selectedSessionId,
      setSelectedSessionId,
      sessionStatus: selectSessionStatus(state, selectedSessionId),
      selectedMessages,
      bootstrapLoading: bootstrapQuery.isLoading,
      selectedSessionLoading: sessionMessagesQuery.isLoading,
      selectedSessionIsError: sessionMessagesQuery.isError,
      selectedSessionError: sessionMessagesQuery.error,
      refetchBootstrap: bootstrapQuery.refetch,
      refetchSelectedSessionMessages: sessionMessagesQuery.refetch,
      selectedHasOptimisticUserMessage,
      addOptimisticUserMessage,
      assignOptimisticUserMessageSession,
      removeOptimisticUserMessage,
    };
  }, [
    state,
    selectedSessionId,
    optimisticUserMessages,
    bootstrapQuery.isLoading,
    bootstrapQuery.refetch,
    sessionMessagesQuery.isLoading,
    sessionMessagesQuery.isError,
    sessionMessagesQuery.error,
    sessionMessagesQuery.refetch,
    addOptimisticUserMessage,
    assignOptimisticUserMessageSession,
    removeOptimisticUserMessage,
  ]);

  return (
    <OpencodeChatContext.Provider value={value}>
      {children}
    </OpencodeChatContext.Provider>
  );
}
