import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { isStudioSoftContextLimitReached } from "../../shared/opencodeContextPolicy.js";
import { getStudioOpencodeSoftContextLimitTokens } from "../config.js";
import type { ModelSelection } from "./modelConfig.js";
import { getDefaultModel } from "./modelConfig.js";
import {
  readSessionNumber,
  readSessionString,
  type SessionMessageRecord,
  toErrorMessage,
} from "./sessionMessageUtils.js";

const sessionTitleCache = new Map<
  string,
  { title: string | undefined; fetchedAt: number }
>();

const DEFAULT_TITLE_TTL_MS = 30_000;
const PENDING_TITLE_TTL_MS = 5_000;

type LatestAssistantTerminalState = {
  hasAssistant: boolean;
  isTerminal: boolean;
  reason:
    | "no_assistant"
    | "assistant_error"
    | "assistant_completed"
    | "assistant_finish"
    | "assistant_unfinished";
};

function isPlaceholderTitle(title: string | undefined): boolean {
  if (!title) return true;
  const t = title.trim().toLowerCase();
  return t === "new session" || t.startsWith("new session");
}

export async function getSessionTitle(
  client: OpencodeClient,
  cwd: string,
  sessionId: string,
): Promise<string | undefined> {
  const cached = sessionTitleCache.get(sessionId);
  if (cached) {
    const ttl = isPlaceholderTitle(cached.title)
      ? PENDING_TITLE_TTL_MS
      : DEFAULT_TITLE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) {
      return cached.title;
    }
  }

  try {
    const result = await client.session.list({ directory: cwd });
    if (result.error) return undefined;
    const sessions = (result.data || []) as any[];
    const match = sessions.find((s) => s?.id === sessionId);
    const title = typeof match?.title === "string" ? match.title : undefined;
    sessionTitleCache.set(sessionId, { title, fetchedAt: Date.now() });
    return title;
  } catch {
    return undefined;
  }
}

function getSessionTokenTotal(
  info: Record<string, unknown> | undefined,
): number | undefined {
  if (!info || typeof info !== "object") {
    return undefined;
  }

  const tokens = info.tokens as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens !== "object") {
    return undefined;
  }

  const explicitTotal = readSessionNumber(tokens.total);
  if (explicitTotal && explicitTotal > 0) {
    return explicitTotal;
  }

  const input = readSessionNumber(tokens.input) ?? 0;
  const output = readSessionNumber(tokens.output) ?? 0;
  const reasoning = readSessionNumber(tokens.reasoning) ?? 0;
  const cache = (tokens.cache as Record<string, unknown> | undefined) ?? {};
  const cacheRead = readSessionNumber(cache.read) ?? 0;
  const cacheWrite = readSessionNumber(cache.write) ?? 0;
  const total = input + output + reasoning + cacheRead + cacheWrite;

  return total > 0 ? total : undefined;
}

function getLatestAssistantContextSnapshot(messages: SessionMessageRecord[]): {
  totalTokens: number;
  provider?: string;
  modelId?: string;
  summary: boolean;
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const info = message?.info;
    if (info?.role !== "assistant") {
      continue;
    }

    const totalTokens = getSessionTokenTotal(info);
    if (!totalTokens) {
      continue;
    }

    return {
      totalTokens,
      provider: readSessionString(
        info.providerID,
        info.providerId,
        (info.model as Record<string, unknown> | undefined)?.providerID,
        (info.model as Record<string, unknown> | undefined)?.providerId,
      ),
      modelId: readSessionString(
        info.modelID,
        info.modelId,
        (info.model as Record<string, unknown> | undefined)?.modelID,
        (info.model as Record<string, unknown> | undefined)?.modelId,
      ),
      summary: info.summary === true,
    };
  }

  return null;
}

function resolveCompactionModelSelection(
  preferredModel: ModelSelection | undefined,
  latestAssistant: {
    provider?: string;
    modelId?: string;
  } | null,
): ModelSelection | null {
  if (preferredModel) {
    return preferredModel;
  }

  if (latestAssistant?.provider && latestAssistant.modelId) {
    return {
      provider: latestAssistant.provider,
      modelId: latestAssistant.modelId,
    };
  }

  return getDefaultModel();
}

function getLatestAssistantTerminalState(
  messages: SessionMessageRecord[],
): LatestAssistantTerminalState {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info;
    if (info?.role !== "assistant") {
      continue;
    }

    if (info.error != null) {
      return {
        hasAssistant: true,
        isTerminal: true,
        reason: "assistant_error",
      };
    }

    const completedAt = readSessionNumber(
      (info.time as Record<string, unknown> | undefined)?.completed,
    );
    if (typeof completedAt === "number") {
      return {
        hasAssistant: true,
        isTerminal: true,
        reason: "assistant_completed",
      };
    }

    const finish = readSessionString(info.finish);
    if (finish && !["tool-calls", "unknown"].includes(finish)) {
      return {
        hasAssistant: true,
        isTerminal: true,
        reason: "assistant_finish",
      };
    }

    return {
      hasAssistant: true,
      isTerminal: false,
      reason: "assistant_unfinished",
    };
  }

  return {
    hasAssistant: false,
    isTerminal: false,
    reason: "no_assistant",
  };
}

export async function inspectLatestAssistantTerminalState(options: {
  client: OpencodeClient;
  directory: string;
  sessionId: string;
}): Promise<LatestAssistantTerminalState> {
  try {
    const result = await options.client.session.messages({
      sessionID: options.sessionId,
      directory: options.directory,
    });
    if (result.error) {
      console.warn(
        `[OpenCode] Failed to inspect session=${options.sessionId} for terminal completion: ${JSON.stringify(result.error)}`,
      );
      return {
        hasAssistant: false,
        isTerminal: false,
        reason: "no_assistant",
      };
    }

    const messages = Array.isArray(result.data)
      ? (result.data as SessionMessageRecord[])
      : [];
    return getLatestAssistantTerminalState(messages);
  } catch (error) {
    console.warn(
      `[OpenCode] Failed to inspect session=${options.sessionId} for terminal completion: ${toErrorMessage(error, "Unknown session inspection failure")}`,
    );
    return {
      hasAssistant: false,
      isTerminal: false,
      reason: "no_assistant",
    };
  }
}

export async function maybeSoftCompactSession(options: {
  client: OpencodeClient;
  directory: string;
  sessionId: string;
  modelSelection?: ModelSelection;
}): Promise<boolean> {
  try {
    const result = await options.client.session.messages({
      sessionID: options.sessionId,
      directory: options.directory,
    });
    if (result.error) {
      console.warn(
        `[OpenCode] Failed to inspect session=${options.sessionId} for soft compaction: ${JSON.stringify(result.error)}`,
      );
      return false;
    }

    const messages = Array.isArray(result.data)
      ? (result.data as SessionMessageRecord[])
      : [];
    const latestAssistant = getLatestAssistantContextSnapshot(messages);
    if (!latestAssistant || latestAssistant.summary) {
      return false;
    }

    const softContextLimitTokens = getStudioOpencodeSoftContextLimitTokens();
    if (
      !isStudioSoftContextLimitReached({
        totalTokens: latestAssistant.totalTokens,
        softLimit: softContextLimitTokens,
      })
    ) {
      return false;
    }

    const compactionModel = resolveCompactionModelSelection(
      options.modelSelection,
      latestAssistant,
    );
    if (!compactionModel) {
      console.warn(
        `[OpenCode] Skipping soft compaction for session=${options.sessionId}; no model is configured.`,
      );
      return false;
    }

    console.log(
      `[OpenCode] Auto-compacting session=${options.sessionId} totalTokens=${latestAssistant.totalTokens} threshold=${softContextLimitTokens} model=${compactionModel.provider}/${compactionModel.modelId}`,
    );
    const summarizeResult = await options.client.session.summarize({
      sessionID: options.sessionId,
      directory: options.directory,
      providerID: compactionModel.provider,
      modelID: compactionModel.modelId,
      auto: true,
    });
    if (summarizeResult.error) {
      console.warn(
        `[OpenCode] Soft compaction failed for session=${options.sessionId}: ${JSON.stringify(summarizeResult.error)}`,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      `[OpenCode] Soft compaction failed for session=${options.sessionId}: ${toErrorMessage(error, "Unknown compaction failure")}`,
    );
    return false;
  }
}

export { toErrorMessage };
