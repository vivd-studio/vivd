import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import {
  agentEventEmitter,
  createAgentEvent,
  type SessionCompletedData,
  type SessionStatus,
} from "./eventEmitter.js";
import { serverManager } from "./serverManager.js";
import { agentLeaseReporter } from "../services/reporting/AgentLeaseReporter.js";

export async function listSessions(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.list({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));

  let sessions = result.data || [];

  sessions = sessions.filter((s: any) => {
    if (!s.directory) return false;
    return (
      s.directory === opencodeDir ||
      s.directory.replace(/\/$/, "") === opencodeDir.replace(/\/$/, "")
    );
  });

  return sessions;
}

export async function listProjects(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.project.list({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function getSessionContent(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.messages({
    sessionID: sessionId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function listQuestions(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.question.list({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function listPermissions(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.permission.list({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function createSession(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.create({ directory: opencodeDir });
  if (result.error) {
    throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`);
  }
  if (!result.data?.id) throw new Error("Session created but no ID returned");
  return result.data;
}

export async function getOrCreateSession(
  client: OpencodeClient,
  directory: string,
  sessionId?: string,
): Promise<string> {
  if (sessionId) {
    return sessionId;
  }

  const result = await client.session.create({ directory });
  if (result.error) {
    throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`);
  }
  if (!result.data?.id) throw new Error("Session created but no ID returned");

  return result.data.id;
}

export async function sessionHasMessages(
  client: OpencodeClient,
  directory: string,
  sessionId: string,
): Promise<boolean> {
  const result = await client.session.messages({
    sessionID: sessionId,
    directory,
  });
  if (result.error) {
    throw new Error(`Failed to load session messages: ${JSON.stringify(result.error)}`);
  }
  return Array.isArray(result.data) && result.data.length > 0;
}

export async function deleteSession(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.delete({
    sessionID: sessionId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  agentLeaseReporter.finishSession(sessionId);
  return true;
}

export async function abortSession(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.abort({
    sessionID: sessionId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));

  agentLeaseReporter.finishSession(sessionId);
  agentEventEmitter.setSessionStatus(sessionId, { type: "idle" });
  agentEventEmitter.emitSessionEvent(
    sessionId,
    createAgentEvent(sessionId, "session.completed", {
      kind: "session.completed",
    } as SessionCompletedData),
  );

  return true;
}

export async function replyQuestion(
  requestId: string,
  answers: string[][],
  directory: string,
) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.question.reply({
    requestID: requestId,
    directory: opencodeDir,
    answers,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return true;
}

export async function rejectQuestion(requestId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.question.reject({
    requestID: requestId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return true;
}

export async function respondPermission(
  requestId: string,
  sessionId: string,
  response: "once" | "always" | "reject",
  directory: string,
) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.permission.respond({
    permissionID: requestId,
    sessionID: sessionId,
    response,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return true;
}

export async function unrevertSession(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);

  const result = await client.session.unrevert({
    sessionID: sessionId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));

  return result.data;
}

export async function getSessionsStatus(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const sessions = await listSessions(directory);
  const result = await client.session.status({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));

  const normalizedStatuses = normalizeSessionStatuses(result.data, sessions);
  const emitterStatuses = agentEventEmitter.getSessionStatuses();
  const emitterStatusSnapshots = agentEventEmitter.getSessionStatusSnapshots();
  const FRESH_BUSY_STATUS_MAX_AGE_MS = 2_000;
  const now = Date.now();

  const statusMap: Record<string, SessionStatus> = {};
  for (const session of sessions) {
    const normalized = normalizedStatuses[session.id];
    const emitter = emitterStatuses[session.id];
    const emitterUpdatedAt = emitterStatusSnapshots[session.id]?.updatedAt ?? 0;
    const emitterAgeMs = emitterUpdatedAt > 0 ? now - emitterUpdatedAt : Infinity;
    const hasFreshEmitterBusy =
      emitter?.type === "busy" && emitterAgeMs <= FRESH_BUSY_STATUS_MAX_AGE_MS;
    const hasEmitterRetryOrError =
      emitter?.type === "retry" || emitter?.type === "error";

    if (normalized) {
      if (normalized.type === "idle" && emitter && hasEmitterRetryOrError) {
        statusMap[session.id] = emitter;
      } else {
        statusMap[session.id] = normalized;
      }
      continue;
    }

    if (emitter && (hasEmitterRetryOrError || hasFreshEmitterBusy)) {
      statusMap[session.id] = emitter;
      continue;
    }

    statusMap[session.id] = { type: "idle" };
  }

  return statusMap;
}

function isSessionStatusLike(value: unknown): value is SessionStatus {
  if (!value || typeof value !== "object") return false;
  const type = (value as any).type;
  return (
    type === "idle" ||
    type === "busy" ||
    type === "done" ||
    type === "retry" ||
    type === "error"
  );
}

function normalizeSessionStatuses(
  data: unknown,
  sessions: { id: string }[],
): Record<string, SessionStatus> {
  if (!data) return {};

  if (Array.isArray(data)) {
    const mapped: Record<string, SessionStatus> = {};
    const unkeyed: SessionStatus[] = [];
    for (const entry of data) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, any>;
      const id = record.sessionID ?? record.sessionId ?? record.id;
      const statusCandidate = record.status ?? record;
      if (!isSessionStatusLike(statusCandidate)) continue;
      const status = statusCandidate as SessionStatus;

      if (id) {
        mapped[id] = status;
      } else {
        unkeyed.push(status);
      }
    }

    if (Object.keys(mapped).length > 0) {
      return mapped;
    }

    if (unkeyed.length === sessions.length && sessions.length > 0) {
      const indexMapped: Record<string, SessionStatus> = {};
      sessions.forEach((session, index) => {
        const status = unkeyed[index];
        if (status) indexMapped[session.id] = status;
      });
      if (Object.keys(indexMapped).length > 0) {
        return indexMapped;
      }
    }

    if (unkeyed.length === 1 && sessions.length === 1) {
      return { [sessions[0].id]: unkeyed[0] };
    }

    return {};
  }

  if (data instanceof Map) {
    return Object.fromEntries(Array.from(data.entries())) as Record<
      string,
      SessionStatus
    >;
  }

  if (typeof data === "object") {
    if (isSessionStatusLike(data)) {
      if (sessions.length === 1) {
        return { [sessions[0].id]: data };
      }
      return {};
    }
    return data as Record<string, SessionStatus>;
  }

  return {};
}
