export type SessionMessageRecord = {
  info?: Record<string, unknown>;
  parts?: Array<Record<string, unknown>>;
};

export type DetailedSessionFileDiff = {
  file: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
  patch?: string;
  before?: string;
  after?: string;
};

export function readSessionString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

export function readSessionNumber(...values: unknown[]): number | undefined {
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

export function normalizeDetailedSessionDiffs(
  value: unknown,
): DetailedSessionFileDiff[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): DetailedSessionFileDiff | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const file = typeof (item as any).file === "string" ? (item as any).file : "";
      if (!file) {
        return null;
      }

      return {
        file,
        additions: Number((item as any).additions) || 0,
        deletions: Number((item as any).deletions) || 0,
        ...(typeof (item as any).status === "string"
          ? { status: (item as any).status as "added" | "deleted" | "modified" }
          : {}),
        ...(typeof (item as any).patch === "string"
          ? { patch: (item as any).patch }
          : {}),
        ...(typeof (item as any).before === "string"
          ? { before: (item as any).before }
          : {}),
        ...(typeof (item as any).after === "string"
          ? { after: (item as any).after }
          : {}),
      };
    })
    .filter((item): item is DetailedSessionFileDiff => Boolean(item));
}

export function toErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) {
    return value.message || fallback;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (value && typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore serialization failures.
    }
  }
  return fallback;
}
