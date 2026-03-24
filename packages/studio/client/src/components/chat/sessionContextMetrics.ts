import type { OpenCodeSessionMessageRecord } from "@/features/opencodeChat";
import type { ModelTier } from "./chatTypes";

export interface SessionContextSnapshot {
  messageId: string;
  providerId?: string;
  modelId?: string;
  providerLabel: string;
  modelLabel: string;
  limit?: number;
  inputLimit?: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  usage: number | null;
  completedAt?: number;
}

export interface SessionContextMetrics {
  totalCost: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  context: SessionContextSnapshot | null;
}

export function getSessionContextMetrics(
  messages: OpenCodeSessionMessageRecord[] = [],
  models: ModelTier[] = [],
): SessionContextMetrics {
  const totalCost = messages.reduce((sum, record) => {
    const info = record.info as Record<string, unknown> | undefined;
    if (info?.role !== "assistant") {
      return sum;
    }
    return sum + numberOrZero(info.cost);
  }, 0);

  const messageCount = messages.length;
  const userMessageCount = messages.reduce(
    (count, record) => count + (record.info?.role === "user" ? 1 : 0),
    0,
  );
  const assistantMessageCount = messages.reduce(
    (count, record) => count + (record.info?.role === "assistant" ? 1 : 0),
    0,
  );

  const latestAssistantWithTokens = [...messages]
    .reverse()
    .find((record) => {
      const info = record.info as Record<string, unknown> | undefined;
      return info?.role === "assistant" && getTokenSnapshot(info) !== null;
    });

  if (!latestAssistantWithTokens) {
    return {
      totalCost,
      messageCount,
      userMessageCount,
      assistantMessageCount,
      context: null,
    };
  }

  const info = latestAssistantWithTokens.info as Record<string, unknown>;
  const tokens = getTokenSnapshot(info);
  if (!tokens) {
    return {
      totalCost,
      messageCount,
      userMessageCount,
      assistantMessageCount,
      context: null,
    };
  }

  const providerId = readString(
    info.providerID,
    info.providerId,
    (info.model as Record<string, unknown> | undefined)?.providerID,
    (info.model as Record<string, unknown> | undefined)?.providerId,
  );
  const modelId = readString(
    info.modelID,
    info.modelId,
    (info.model as Record<string, unknown> | undefined)?.modelID,
    (info.model as Record<string, unknown> | undefined)?.modelId,
  );
  const matchedModel = models.find(
    (entry) => entry.provider === providerId && entry.modelId === modelId,
  );
  const limit = matchedModel?.contextLimit;
  const inputLimit = matchedModel?.inputLimit;

  return {
    totalCost,
    messageCount,
    userMessageCount,
    assistantMessageCount,
    context: {
      messageId: String(info.id ?? ""),
      providerId,
      modelId,
      providerLabel:
        matchedModel?.providerLabel || providerId || matchedModel?.provider || "Unknown",
      modelLabel:
        matchedModel?.modelLabel || modelId || matchedModel?.modelId || "Unknown",
      limit,
      inputLimit,
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      total: tokens.total,
      usage: limit ? Math.round((tokens.total / limit) * 100) : null,
      completedAt: readNumber(
        (info.time as Record<string, unknown> | undefined)?.completed,
        (info.time as Record<string, unknown> | undefined)?.updated,
        (info.time as Record<string, unknown> | undefined)?.created,
      ),
    },
  };
}

function getTokenSnapshot(info: Record<string, unknown>) {
  const tokens = info.tokens as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens !== "object") {
    return null;
  }

  const input = numberOrZero(tokens.input);
  const output = numberOrZero(tokens.output);
  const reasoning = numberOrZero(tokens.reasoning);
  const cache = (tokens.cache as Record<string, unknown> | undefined) ?? {};
  const cacheRead = numberOrZero(cache.read);
  const cacheWrite = numberOrZero(cache.write);
  const explicitTotal = numberOrZero(tokens.total);
  const total = explicitTotal || input + output + reasoning + cacheRead + cacheWrite;

  if (total <= 0) {
    return null;
  }

  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total,
  };
}

function numberOrZero(value: unknown): number {
  return readNumber(value) ?? 0;
}

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}
