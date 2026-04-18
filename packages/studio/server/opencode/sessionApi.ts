import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import {
  agentEventEmitter,
  createAgentEvent,
  type SessionCompletedData,
  type SessionErrorData,
  type SessionStatus,
} from "./eventEmitter.js";
import { serverManager } from "./serverManager.js";
import { inspectLatestAssistantTerminalState } from "./sessionHelpers.js";
import { getStudioOpencodeOrphanedBusyGraceMs } from "../config.js";
import { agentLeaseReporter } from "../services/reporting/AgentLeaseReporter.js";

const FRESH_BUSY_STATUS_MAX_AGE_MS = 2_000;
const CURRENT_PROCESS_STARTED_AT_MS = Math.max(
  0,
  Date.now() - Math.floor(process.uptime() * 1000),
);

type SessionIdentity = { id: string };

type OrphanedBusySessionReconcileResult =
  | { reconciled: false }
  | { reconciled: true; message: string };

const orphanedBusySessionReconciles = new Map<
  string,
  Promise<OrphanedBusySessionReconcileResult>
>();

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
  await maybeReconcileOrphanedBusySessionIfNeeded({
    client,
    directory: opencodeDir,
    sessionId,
  });
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
  const normalizedStatuses = await loadNormalizedSessionStatuses(
    client,
    opencodeDir,
    sessions,
  );
  for (const session of sessions) {
    if (normalizedStatuses[session.id]?.type !== "busy") {
      continue;
    }

    const reconcileResult = await maybeReconcileOrphanedBusySession({
      client,
      directory: opencodeDir,
      sessionId: session.id,
    });
    if (reconcileResult.reconciled) {
      normalizedStatuses[session.id] = { type: "idle" };
    }
  }

  const emitterStatuses = agentEventEmitter.getSessionStatuses();
  const emitterStatusSnapshots = agentEventEmitter.getSessionStatusSnapshots();
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

async function loadNormalizedSessionStatuses(
  client: OpencodeClient,
  directory: string,
  sessions: SessionIdentity[],
): Promise<Record<string, SessionStatus>> {
  const result = await client.session.status({ directory });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return normalizeSessionStatuses(result.data, sessions);
}

async function maybeReconcileOrphanedBusySessionIfNeeded(options: {
  client: OpencodeClient;
  directory: string;
  sessionId: string;
}): Promise<boolean> {
  const statuses = await loadNormalizedSessionStatuses(
    options.client,
    options.directory,
    [{ id: options.sessionId }],
  );
  if (statuses[options.sessionId]?.type !== "busy") {
    return false;
  }

  const result = await maybeReconcileOrphanedBusySession(options);
  return result.reconciled;
}

async function maybeReconcileOrphanedBusySession(options: {
  client: OpencodeClient;
  directory: string;
  sessionId: string;
}): Promise<OrphanedBusySessionReconcileResult> {
  const key = `${options.directory}::${options.sessionId}`;
  const inFlight = orphanedBusySessionReconciles.get(key);
  if (inFlight) {
    return inFlight;
  }

  const run = maybeReconcileOrphanedBusySessionImpl(options).finally(() => {
    if (orphanedBusySessionReconciles.get(key) === run) {
      orphanedBusySessionReconciles.delete(key);
    }
  });
  orphanedBusySessionReconciles.set(key, run);
  return run;
}

async function maybeReconcileOrphanedBusySessionImpl(options: {
  client: OpencodeClient;
  directory: string;
  sessionId: string;
}): Promise<OrphanedBusySessionReconcileResult> {
  if (agentLeaseReporter.hasActiveSession(options.sessionId)) {
    return { reconciled: false };
  }

  const latestAssistantState = await inspectLatestAssistantTerminalState({
    client: options.client,
    directory: options.directory,
    sessionId: options.sessionId,
  });
  if (!latestAssistantState.hasAssistant || latestAssistantState.isTerminal) {
    return { reconciled: false };
  }

  const activityAtMs = latestAssistantState.activityAtMs;
  if (typeof activityAtMs !== "number" || !Number.isFinite(activityAtMs)) {
    return { reconciled: false };
  }

  const now = Date.now();
  const activityAgeMs = Math.max(0, now - activityAtMs);
  const orphanedBusyGraceMs = getStudioOpencodeOrphanedBusyGraceMs();
  const predatesCurrentProcess = activityAtMs < CURRENT_PROCESS_STARTED_AT_MS;
  const exceededGraceWindow = activityAgeMs >= orphanedBusyGraceMs;

  if (!predatesCurrentProcess && !exceededGraceWindow) {
    return { reconciled: false };
  }

  const message = predatesCurrentProcess
    ? "Studio interrupted this session after the runtime restarted because OpenCode still reported it as busy without an attached local run."
    : `Studio interrupted this session because OpenCode kept reporting it as busy for more than ${Math.round(orphanedBusyGraceMs / 60_000)} minutes without an attached local run.`;

  console.warn(
    `[OpenCode] Aborting orphaned busy session=${options.sessionId} processStartedAtMs=${CURRENT_PROCESS_STARTED_AT_MS} activityAtMs=${activityAtMs} activityAgeMs=${activityAgeMs} graceMs=${orphanedBusyGraceMs}`,
  );

  const abortResult = await options.client.session.abort({
    sessionID: options.sessionId,
    directory: options.directory,
  });
  if (abortResult.error) {
    console.warn(
      `[OpenCode] Failed to abort orphaned busy session=${options.sessionId}: ${JSON.stringify(abortResult.error)}`,
    );
    return { reconciled: false };
  }

  agentLeaseReporter.finishSession(options.sessionId);
  agentEventEmitter.emitSessionEvent(
    options.sessionId,
    createAgentEvent(options.sessionId, "session.error", {
      kind: "session.error",
      errorType: "error",
      message,
    } as SessionErrorData),
  );

  return {
    reconciled: true,
    message,
  };
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
