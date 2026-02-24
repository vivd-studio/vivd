import type { MouseEvent } from "react";

export interface Message {
  id?: string;
  role: "user" | "agent";
  content: string;
  parts?: any[];
  createdAt?: number;
}

export interface Session {
  id: string;
  title?: string;
  time?: {
    created?: number;
    updated?: number;
  };
  revert?: { messageID: string };
}

export interface AttachedElement {
  selector: string;
  description: string;
  text?: string;
  filename?: string;
  astroSourceFile?: string | null;
  astroSourceLoc?: string | null;
}

export interface AttachedImage {
  file: File;
  previewUrl: string;
  tempId: string;
}

export interface AttachedFile {
  path: string;
  filename: string;
  id: string;
}

export interface UsageData {
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
}

export interface SessionDebugState {
  selectedSessionId: string | null;
  isStreaming: boolean;
  isWaiting: boolean;
  isThinking: boolean;
  streamingPartsCount: number;
  messagesCount: number;
  sseConnected: boolean;
  lastEventTime: string | null;
  lastEventType: string | null;
  lastEventId: string | null;
  sessionError: SessionError | null;
  sessionStatus: string | null;
  usage: UsageData | null;
}

export interface SessionError {
  type: string;
  message: string;
  attempt?: number;
  nextRetryAt?: number;
}

export interface UsageLimitStatus {
  blocked: boolean;
  imageGenBlocked: boolean;
  warnings: string[];
  usage: {
    daily: { current: number; limit: number; percentage: number };
    weekly: { current: number; limit: number; percentage: number };
    monthly: { current: number; limit: number; percentage: number };
    imageGen: { current: number; limit: number; percentage: number };
  };
  nextReset: {
    daily: Date | string;
    weekly: Date | string;
    monthly: Date | string;
  };
}

export interface ModelTier {
  tier: "standard" | "advanced" | "pro";
  provider: string;
  modelId: string;
  label: string;
}

export interface ChatContextValue {
  projectSlug: string;
  version?: number;
  sessions: Session[];
  sessionsLoading: boolean;
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
  isSessionHydrating: boolean;
  messages: Message[];
  isStreaming: boolean;
  isWaiting: boolean;
  isThinking: boolean;
  streamingParts: any[];
  input: string;
  setInput: (value: string) => void;
  attachedElement: AttachedElement | null;
  setAttachedElement: (element: AttachedElement | null) => void;
  attachedImages: AttachedImage[];
  addAttachedImages: (images: AttachedImage[]) => void;
  removeAttachedImage: (tempId: string) => void;
  attachedFiles: AttachedFile[];
  addAttachedFile: (file: AttachedFile) => void;
  removeAttachedFile: (id: string) => void;
  selectorMode: boolean;
  setSelectorMode: ((mode: boolean) => void) | undefined;
  selectorModeAvailable: boolean;
  isReverted: boolean;
  isLoading: boolean;
  sessionDebugState: SessionDebugState;
  sessionError: SessionError | null;
  clearSessionError: () => void;
  usageLimitStatus: UsageLimitStatus | null;
  isUsageBlocked: boolean;
  availableModels: ModelTier[];
  selectedModel: ModelTier | null;
  setSelectedModel: (model: ModelTier | null) => void;
  handleSend: () => void;
  handleNewSession: () => void;
  handleDeleteSession: (e: MouseEvent, sessionId: string) => void;
  handleRevert: (messageId: string) => void;
  handleUnrevert: () => void;
  handleStopGeneration: () => void;
}
