export type ToolStatus = "running" | "completed" | "error";
export type DeltaPartType = "reasoning" | "text";
export type EventDedupState = { ids: Set<string>; queue: string[] };
export type ToolActivityLabelParts = { action: string; target?: string };
const REDACTED_THOUGHT_PATTERN = /\[REDACTED\]/gi;
const TOOL_TARGET_INPUT_KEYS = [
  "path",
  "filePath",
  "filepath",
  "file_path",
  "filename",
  "file",
  "fileName",
  "name",
  "target_file",
  "target",
  "targetPath",
  "target_path",
  "source",
  "sourcePath",
  "source_path",
  "sourceFile",
  "source_file",
] as const;

export function normalizeToolStatus(
  part: any,
): "running" | "completed" | "error" | undefined {
  const status = part?.status ?? part?.state?.status;
  if (status === "running" || status === "completed" || status === "error") {
    return status;
  }
  return undefined;
}

export function normalizeErrorMessage(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Error) return value.message || "Unknown error";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nestedCandidates = [
      record.message,
      record.error,
      record.reason,
      record.detail,
    ];
    for (const candidate of nestedCandidates) {
      const nested = normalizeErrorMessage(candidate);
      if (nested) return nested;
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore serialization errors.
    }
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function normalizeMessagePart(part: any): any {
  if (!part || typeof part !== "object") return part;
  if (part.type === "reasoning") {
    const sanitized = sanitizeThoughtText(part.text ?? "");
    if (!sanitized.trim()) return null;
    return {
      ...part,
      text: sanitized,
    };
  }
  if (part.type !== "tool") return part;

  return {
    ...part,
    status: normalizeToolStatus(part) ?? "completed",
    input: part.input ?? part.state?.input,
    error: normalizeErrorMessage(
      part.error ??
        part.state?.error ??
        part.output?.error ??
        part.state?.output?.error,
    ),
  };
}

function pathToFilename(pathLike: string): string | undefined {
  const trimmed = pathLike.trim();
  if (!trimmed) return undefined;

  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const segments = withoutQuery.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || undefined;
}

function parseObjectInput(input: unknown): Record<string, unknown> | null {
  if (!input) return null;

  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON.
  }

  return null;
}

function extractToolTargetName(input: unknown): string | undefined {
  if (typeof input === "string") {
    return pathToFilename(input);
  }

  const obj = parseObjectInput(input);
  if (!obj) return undefined;

  for (const key of TOOL_TARGET_INPUT_KEYS) {
    const value = obj[key];
    if (typeof value !== "string") continue;
    const filename = pathToFilename(value);
    if (filename) return filename;
  }

  return undefined;
}

export function getToolActivityLabelParts(part: any): ToolActivityLabelParts {
  const status = normalizeToolStatus(part) ?? "completed";
  const toolName = String(part?.tool ?? "").trim().toLowerCase();
  const target = extractToolTargetName(part?.input);

  if (toolName === "read") {
    if (status === "running") {
      return { action: "Exploring", target: `${target ?? "file"}...` };
    }
    if (status === "error") {
      return { action: "Failed exploring", target: target ?? "file" };
    }
    return { action: "Explored", target: target ?? "file" };
  }

  if (toolName === "edit") {
    if (status === "running") {
      return { action: "Editing", target: `${target ?? "file"}...` };
    }
    if (status === "error") {
      return { action: "Failed editing", target: target ?? "file" };
    }
    return { action: "Edited", target: target ?? "file" };
  }

  if (toolName === "write") {
    if (status === "running") {
      if (target) {
        return { action: "Editing", target: `${target}...` };
      }
      return { action: "Editing" };
    }
    if (status === "error") {
      return { action: "Failed editing", target: target ?? "file" };
    }
    return { action: "Edited", target: target ?? "file" };
  }

  if (toolName === "glob") {
    if (status === "running") return { action: "Exploring", target: "files..." };
    if (status === "error") return { action: "Failed exploring", target: "files" };
    return { action: "Explored", target: "files" };
  }

  if (toolName === "bash") {
    if (status === "running") return { action: "Running", target: "command..." };
    if (status === "error") return { action: "Command failed" };
    return { action: "Executed", target: "command" };
  }

  if (status === "running") return { action: "Running", target: "tool..." };
  if (status === "error") return { action: "Tool failed" };
  return { action: "Completed", target: "tool action" };
}

export function getToolActivityLabel(part: any): string {
  const parts = getToolActivityLabelParts(part);
  return parts.target ? `${parts.action} ${parts.target}` : parts.action;
}

export function upsertDeltaStreamingPart(
  prev: any[],
  partId: string,
  type: DeltaPartType,
  content: string,
): any[] {
  const existingIndex = prev.findIndex((p) => p.id === partId);
  const existingText =
    existingIndex >= 0 ? String(prev[existingIndex]?.text ?? "") : "";
  const mergedText = `${existingText}${content}`;
  const nextText =
    type === "reasoning" ? sanitizeThoughtText(mergedText) : mergedText;

  // If reasoning became empty after stripping placeholders, remove/hide it.
  if (type === "reasoning" && !nextText.trim()) {
    if (existingIndex === -1) {
      return prev;
    }
    return prev.filter((_, index) => index !== existingIndex);
  }

  if (existingIndex === -1) {
    return [...prev, { id: partId, type, text: nextText }];
  }

  const next = [...prev];
  next[existingIndex] = {
    ...next[existingIndex],
    id: partId,
    type,
    text: nextText,
  };
  return next;
}

export function upsertToolStartedPart(
  prev: any[],
  toolId: string,
  tool: string,
  title?: string,
  input?: unknown,
): any[] {
  const existingIndex = prev.findIndex((p) => p.id === toolId);
  const nextPart = {
    id: toolId,
    type: "tool",
    tool,
    title,
    input,
    status: "running" as const,
  };

  if (existingIndex === -1) {
    return [...prev, nextPart];
  }

  const next = [...prev];
  next[existingIndex] = {
    ...next[existingIndex],
    ...nextPart,
  };
  return next;
}

export function updateToolPartStatus(
  prev: any[],
  toolId: string,
  status: ToolStatus,
  error?: string,
): any[] {
  return prev.map((part) => {
    if (part.id !== toolId) return part;
    if (status === "error") {
      return { ...part, status, error };
    }
    return { ...part, status };
  });
}

export function markEventAsProcessed(
  state: Map<string, EventDedupState>,
  sessionId: string,
  eventId: string,
  dedupeWindow: number,
): boolean {
  const entry = state.get(sessionId) ?? {
    ids: new Set<string>(),
    queue: [],
  };
  if (entry.ids.has(eventId)) {
    return false;
  }

  entry.ids.add(eventId);
  entry.queue.push(eventId);
  if (entry.queue.length > dedupeWindow) {
    const evicted = entry.queue.shift();
    if (evicted) {
      entry.ids.delete(evicted);
    }
  }
  state.set(sessionId, entry);
  return true;
}

export function sanitizeThoughtText(text: string): string {
  if (!text) return "";

  // OpenRouter may return raw "[REDACTED]" placeholders in reasoning.
  const withoutRedacted = text.replace(REDACTED_THOUGHT_PATTERN, "");

  return withoutRedacted
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
