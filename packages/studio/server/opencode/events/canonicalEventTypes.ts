export type CanonicalAgentEventType = string;

export type BridgeStatusState =
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface BridgeStatusData {
  state: BridgeStatusState;
  message?: string;
}

export interface CanonicalAgentEventInput {
  workspaceKey: string;
  sessionId: string | null;
  type: CanonicalAgentEventType;
  timestamp: number;
  properties: unknown;
}

export interface CanonicalAgentEvent extends CanonicalAgentEventInput {
  eventId: string;
  sequence: number;
}
