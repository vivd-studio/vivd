import type {
  OpenCodePermissionRequest,
  OpenCodeQuestionRequest,
  OpenCodeSession,
} from "../types";

function sessionTreeRequest<T>(
  sessions: OpenCodeSession[],
  requests: Record<string, T[] | undefined>,
  sessionId?: string | null,
  include: (item: T) => boolean = () => true,
): T | undefined {
  if (!sessionId) return undefined;

  const childrenByParentId = sessions.reduce((acc, session) => {
    if (!session.parentID) return acc;
    const children = acc.get(session.parentID) ?? [];
    children.push(session.id);
    acc.set(session.parentID, children);
    return acc;
  }, new Map<string, string[]>());

  const seen = new Set([sessionId]);
  const sessionIds = [sessionId];
  for (const currentId of sessionIds) {
    const children = childrenByParentId.get(currentId);
    if (!children) continue;

    for (const childId of children) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      sessionIds.push(childId);
    }
  }

  const matchedSessionId = sessionIds.find((id) => requests[id]?.some(include));
  if (!matchedSessionId) return undefined;
  return requests[matchedSessionId]?.find(include);
}

export function sessionQuestionRequest(
  sessions: OpenCodeSession[],
  requests: Record<string, OpenCodeQuestionRequest[] | undefined>,
  sessionId?: string | null,
  include?: (item: OpenCodeQuestionRequest) => boolean,
): OpenCodeQuestionRequest | undefined {
  return sessionTreeRequest(sessions, requests, sessionId, include);
}

export function sessionPermissionRequest(
  sessions: OpenCodeSession[],
  requests: Record<string, OpenCodePermissionRequest[] | undefined>,
  sessionId?: string | null,
  include?: (item: OpenCodePermissionRequest) => boolean,
): OpenCodePermissionRequest | undefined {
  return sessionTreeRequest(sessions, requests, sessionId, include);
}
