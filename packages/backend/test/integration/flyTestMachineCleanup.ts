import type { FlyStudioMachineProvider } from "../../src/services/studioMachines/fly/provider";
import type { FlyStudioMachineSummary } from "../../src/services/studioMachines/fly/types";

const DEFAULT_STALE_TEST_MACHINE_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_STALE_TEST_MACHINE_DELETE_LIMIT = 25;

export const DEFAULT_FLY_TEST_PROJECT_SLUG_PREFIXES = [
  "warm-wake-",
  "reconcile-e2e-",
  "prod-shape-",
  "studio-opencode-rehydrate-",
  "studio-shutdown-sync-",
  "studio-vertex-only-reply-",
] as const;

function parseOptionalPositiveIntEnv(name: string): number | null {
  const raw = (process.env[name] || "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseCsvEnv(name: string): string[] {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isOlderThan(createdAt: string | null, maxAgeMs: number): boolean {
  if (!createdAt) return false;
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs >= maxAgeMs;
}

function matchesTestPrefix(
  summary: FlyStudioMachineSummary,
  projectSlugPrefixes: readonly string[],
): boolean {
  return projectSlugPrefixes.some((prefix) => summary.projectSlug.startsWith(prefix));
}

function formatMachine(summary: FlyStudioMachineSummary): string {
  return `${summary.projectSlug}/v${summary.version} (${summary.id}, state=${summary.state || "unknown"}, createdAt=${summary.createdAt || "unknown"})`;
}

export function isFlyCapacityExhaustionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("rate limit exceeded")) return false;

  return (
    normalized.includes("resource_exhausted") ||
    normalized.includes("machine limit") ||
    normalized.includes("quota") ||
    normalized.includes("insufficient capacity") ||
    normalized.includes("no capacity") ||
    normalized.includes("capacity exceeded")
  );
}

export async function cleanupStaleFlyTestMachines(options: {
  provider: FlyStudioMachineProvider;
  projectSlugPrefixes?: readonly string[];
  excludeProjectSlugs?: readonly string[];
  maxAgeMs?: number;
  limit?: number;
  logPrefix?: string;
}): Promise<{ scanned: number; deleted: string[] }> {
  const prefixes =
    options.projectSlugPrefixes ?? DEFAULT_FLY_TEST_PROJECT_SLUG_PREFIXES;
  const maxAgeMs =
    options.maxAgeMs ??
    parseOptionalPositiveIntEnv("VIVD_FLY_TEST_STALE_MACHINE_MAX_AGE_MS") ??
    DEFAULT_STALE_TEST_MACHINE_MAX_AGE_MS;
  const limit =
    options.limit ??
    parseOptionalPositiveIntEnv("VIVD_FLY_TEST_STALE_MACHINE_DELETE_LIMIT") ??
    DEFAULT_STALE_TEST_MACHINE_DELETE_LIMIT;
  const excludeProjectSlugs = new Set(
    options.excludeProjectSlugs ??
      parseCsvEnv("VIVD_FLY_TEST_STALE_MACHINE_EXCLUDE_PROJECT_SLUGS"),
  );
  const logPrefix = options.logPrefix ?? "[Fly test GC]";

  let summaries: FlyStudioMachineSummary[];
  try {
    summaries = await options.provider.listStudioMachines();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${logPrefix} Could not list machines for stale-test cleanup: ${message}`);
    return { scanned: 0, deleted: [] };
  }

  const candidates = summaries
    .filter((summary) => {
      if (!matchesTestPrefix(summary, prefixes)) return false;
      if (excludeProjectSlugs.has(summary.projectSlug)) return false;
      const state = (summary.state || "").toLowerCase();
      if (state === "destroyed" || state === "destroying") return false;
      return isOlderThan(summary.createdAt, maxAgeMs);
    })
    .sort((left, right) => (left.createdAt || "").localeCompare(right.createdAt || ""))
    .slice(0, limit);

  const deleted: string[] = [];
  for (const summary of candidates) {
    try {
      console.warn(`${logPrefix} Destroying stale test machine ${formatMachine(summary)}`);
      await options.provider.destroyStudioMachine(summary.id);
      deleted.push(summary.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `${logPrefix} Failed to destroy stale test machine ${formatMachine(summary)}: ${message}`,
      );
    }
  }

  if (candidates.length > 0) {
    console.warn(
      `${logPrefix} scanned=${summaries.length} staleCandidates=${candidates.length} deleted=${deleted.length}`,
    );
  }

  return {
    scanned: summaries.length,
    deleted,
  };
}

export async function runWithFlyCapacityContext<T>(options: {
  run: () => Promise<T>;
  context: string;
}): Promise<T> {
  try {
    return await options.run();
  } catch (error) {
    if (!isFlyCapacityExhaustionError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[Fly test infra] Fly capacity is exhausted while ${options.context}. Clear stale test machines or raise Fly machine capacity before rerunning. Original error: ${message}`,
    );
  }
}
