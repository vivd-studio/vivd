export const DEFAULT_TRPC_REQUEST_TIMEOUT_MS = 15_000;
export const LONG_TRPC_REQUEST_TIMEOUT_MS = 3 * 60_000;
export const EXTENDED_TRPC_REQUEST_TIMEOUT_MS = 5 * 60_000;
export const AGENT_TASK_TRPC_REQUEST_TIMEOUT_MS = 15 * 60_000;

const TRPC_URL_MARKER = "/trpc/";

const PROCEDURE_TIMEOUT_MS = new Map<string, number>([
  ["agent.runTask", AGENT_TASK_TRPC_REQUEST_TIMEOUT_MS],
  ["agent.startInitialGeneration", AGENT_TASK_TRPC_REQUEST_TIMEOUT_MS],
  ["agent.runPrePublishChecklist", LONG_TRPC_REQUEST_TIMEOUT_MS],
  ["agent.fixChecklistItem", LONG_TRPC_REQUEST_TIMEOUT_MS],
  ["project.gitSave", LONG_TRPC_REQUEST_TIMEOUT_MS],
  ["project.gitHubPullFastForward", EXTENDED_TRPC_REQUEST_TIMEOUT_MS],
  ["project.gitHubForceSync", EXTENDED_TRPC_REQUEST_TIMEOUT_MS],
  ["project.publish", EXTENDED_TRPC_REQUEST_TIMEOUT_MS],
]);

function extractTrpcProcedures(url: string | URL): string[] {
  const urlString = typeof url === "string" ? url : url.toString();
  const markerIndex = url.indexOf(TRPC_URL_MARKER);
  if (markerIndex < 0) return [];

  let procedurePath = urlString.slice(markerIndex + TRPC_URL_MARKER.length);
  const queryIndex = procedurePath.indexOf("?");
  if (queryIndex >= 0) {
    procedurePath = procedurePath.slice(0, queryIndex);
  }
  if (!procedurePath) return [];

  return procedurePath
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return "";
      try {
        return decodeURIComponent(trimmed);
      } catch {
        return trimmed;
      }
    })
    .filter(Boolean);
}

export function resolveTrpcRequestTimeoutMs(url: string | URL): number {
  const procedures = extractTrpcProcedures(url);
  if (procedures.length === 0) {
    return DEFAULT_TRPC_REQUEST_TIMEOUT_MS;
  }

  let timeoutMs = DEFAULT_TRPC_REQUEST_TIMEOUT_MS;
  for (const procedure of procedures) {
    const configuredTimeout = PROCEDURE_TIMEOUT_MS.get(procedure);
    if (
      typeof configuredTimeout === "number" &&
      Number.isFinite(configuredTimeout) &&
      configuredTimeout > timeoutMs
    ) {
      timeoutMs = configuredTimeout;
    }
  }
  return timeoutMs;
}

export function isLikelyTrpcTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message) return false;

  const normalized = message.toLowerCase();
  const looksLikeTimeout =
    /timed out after \d+\s*ms/.test(normalized) ||
    /timeout(?: error)?(?: of)? \d+\s*ms/.test(normalized) ||
    normalized.includes("request timed out");

  return (
    looksLikeTimeout ||
    normalized.includes("aborterror") ||
    normalized.includes("operation was aborted") ||
    normalized.includes("signal is aborted")
  );
}
