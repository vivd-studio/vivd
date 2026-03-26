export type OpenCodeConnectionState =
  | "idle"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type OpenCodeSessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "done" }
  | { type: "retry"; attempt?: number; message?: string; next?: number };

export interface OpenCodeSession {
  id: string;
  parentID?: string | null;
  title?: string;
  time?: {
    created?: number;
    updated?: number;
    archived?: number | boolean | null;
  };
  revert?: { messageID: string };
  [key: string]: unknown;
}

export interface OpenCodeMessage {
  id: string;
  sessionID: string;
  parentID?: string | null;
  role?: string;
  time?: {
    created?: number;
    updated?: number;
    completed?: number;
  };
  [key: string]: unknown;
}

export interface OpenCodePart {
  id: string;
  messageID: string;
  sessionID?: string;
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface OpenCodeQuestionOption {
  label: string;
  description?: string;
  [key: string]: unknown;
}

export interface OpenCodeQuestionInfo {
  question: string;
  header: string;
  options: OpenCodeQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
  [key: string]: unknown;
}

export type OpenCodeQuestionAnswer = string[];

export interface OpenCodeQuestionRequest {
  id: string;
  sessionID: string;
  questions: OpenCodeQuestionInfo[];
  tool?: {
    messageID: string;
    callID: string;
  };
  [key: string]: unknown;
}

export interface CanonicalChatEvent {
  eventId?: string;
  type: string;
  sessionId?: string | null;
  timestamp?: number;
  properties?: Record<string, unknown>;
}

export interface OpenCodeSessionMessageRecord {
  info: OpenCodeMessage;
  parts?: OpenCodePart[];
}

export interface OpenCodeOptimisticUserMessage {
  clientId: string;
  sessionId: string | null;
  content: string;
  createdAt: number;
}

export interface OpenCodeChatBootstrap {
  sessions: OpenCodeSession[];
  statuses: Record<string, OpenCodeSessionStatus>;
  messages: OpenCodeSessionMessageRecord[];
  questions: OpenCodeQuestionRequest[];
}

export interface OpenCodeChatSessionViewMessage extends OpenCodeMessage {
  parts: OpenCodePart[];
}

export interface OpenCodeSessionActivitySummary {
  selectedSessionId: string | null;
  activeSessionIds: string[];
  selectedSessionIsActive: boolean;
  otherActiveSessionIds: string[];
  otherActiveSessionCount: number;
  hasAnyActiveSession: boolean;
  hasOtherActiveSessions: boolean;
}

export interface OpenCodeChatState {
  connection: {
    state: OpenCodeConnectionState;
    message?: string;
  };
  sessionsById: Record<string, OpenCodeSession>;
  sessionOrder: string[];
  messagesById: Record<string, OpenCodeMessage>;
  messagesBySessionId: Record<string, string[]>;
  partsByMessageId: Record<string, OpenCodePart[]>;
  sessionStatusById: Record<string, OpenCodeSessionStatus>;
  questionRequestsBySessionId: Record<string, OpenCodeQuestionRequest[]>;
  lastEventId: string | null;
  lastEventType: string | null;
  lastEventTime: number | null;
  refreshGeneration: number;
  bootstrapped: boolean;
}

export type OpenCodeChatAction =
  | { type: "bootstrap.loaded"; payload: OpenCodeChatBootstrap }
  | {
      type: "session.messages.loaded";
      payload: { sessionId: string; messages: OpenCodeSessionMessageRecord[] };
    }
  | { type: "event.received"; payload: CanonicalChatEvent }
  | { type: "events.receivedBatch"; payload: CanonicalChatEvent[] }
  | {
      type: "connection.updated";
      payload: { state: OpenCodeConnectionState; message?: string };
    };

export const OPEN_CODE_CHAT_INITIAL_STATE: OpenCodeChatState = {
  connection: {
    state: "idle",
  },
  sessionsById: {},
  sessionOrder: [],
  messagesById: {},
  messagesBySessionId: {},
  partsByMessageId: {},
  sessionStatusById: {},
  questionRequestsBySessionId: {},
  lastEventId: null,
  lastEventType: null,
  lastEventTime: null,
  refreshGeneration: 0,
  bootstrapped: false,
};
