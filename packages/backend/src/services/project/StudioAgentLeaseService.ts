type StudioAgentLeaseIdentity = {
  organizationId: string;
  slug: string;
  version: number;
  studioId: string;
  sessionId: string;
  runId: string;
};

type StudioAgentLeaseRecord = StudioAgentLeaseIdentity & {
  startedAtMs: number;
  lastHeartbeatAtMs: number;
  maxExceededAtMs: number | null;
};

type StudioAgentLeaseServiceOptions = {
  now?: () => number;
  leaseTtlMs?: number;
  maxLeaseMs?: number;
};

export type StudioAgentLeaseState = "active" | "max_exceeded";

export type StudioAgentLeaseActiveResult = {
  leaseState: StudioAgentLeaseState;
  ageMs: number;
  activeRuns: number;
};

const DEFAULT_AGENT_LEASE_TTL_MS = 90_000;
const DEFAULT_AGENT_LEASE_MAX_MS = 45 * 60_000;
const CLEANUP_FACTOR = 8;

function keyFor(identity: { organizationId: string; slug: string; version: number }): string {
  return `${identity.organizationId}:${identity.slug}:v${identity.version}`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export class StudioAgentLeaseService {
  private readonly now: () => number;
  private readonly leaseTtlMs: number;
  private readonly maxLeaseMs: number;
  private readonly recordsByStudioKey = new Map<string, Map<string, StudioAgentLeaseRecord>>();

  constructor(options: StudioAgentLeaseServiceOptions = {}) {
    this.now = options.now || (() => Date.now());
    this.leaseTtlMs = options.leaseTtlMs
      ? Math.max(1_000, options.leaseTtlMs)
      : parsePositiveInt(process.env.AGENT_LEASE_TTL_MS, DEFAULT_AGENT_LEASE_TTL_MS);
    this.maxLeaseMs = options.maxLeaseMs
      ? Math.max(5_000, options.maxLeaseMs)
      : parsePositiveInt(process.env.AGENT_LEASE_MAX_MS, DEFAULT_AGENT_LEASE_MAX_MS);
  }

  reportActive(identity: StudioAgentLeaseIdentity): StudioAgentLeaseActiveResult {
    const now = this.now();
    this.cleanup(now);

    const studioKey = keyFor(identity);
    const runs =
      this.recordsByStudioKey.get(studioKey) || new Map<string, StudioAgentLeaseRecord>();

    let record = runs.get(identity.runId);
    if (!record) {
      record = {
        ...identity,
        startedAtMs: now,
        lastHeartbeatAtMs: now,
        maxExceededAtMs: null,
      };
      runs.set(identity.runId, record);
    } else {
      record.lastHeartbeatAtMs = now;
      record.sessionId = identity.sessionId;
      record.studioId = identity.studioId;
    }

    const ageMs = Math.max(0, now - record.startedAtMs);
    if (record.maxExceededAtMs == null && ageMs > this.maxLeaseMs) {
      record.maxExceededAtMs = now;
    }

    this.recordsByStudioKey.set(studioKey, runs);

    return {
      leaseState: record.maxExceededAtMs == null ? "active" : "max_exceeded",
      ageMs,
      activeRuns: this.countActiveRuns(runs),
    };
  }

  reportIdle(identity: {
    organizationId: string;
    slug: string;
    version: number;
    runId: string;
  }): { removed: boolean } {
    const now = this.now();
    this.cleanup(now);

    const studioKey = keyFor(identity);
    const runs = this.recordsByStudioKey.get(studioKey);
    if (!runs) return { removed: false };

    const removed = runs.delete(identity.runId);
    if (runs.size === 0) {
      this.recordsByStudioKey.delete(studioKey);
    }
    return { removed };
  }

  private countActiveRuns(runs: Map<string, StudioAgentLeaseRecord>): number {
    let count = 0;
    for (const record of runs.values()) {
      if (record.maxExceededAtMs == null) count += 1;
    }
    return count;
  }

  private cleanup(now: number): void {
    const ttlMs = Math.max(
      this.leaseTtlMs * CLEANUP_FACTOR,
      this.maxLeaseMs * 2,
    );
    for (const [studioKey, runs] of this.recordsByStudioKey.entries()) {
      for (const [runId, record] of runs.entries()) {
        if (now - record.lastHeartbeatAtMs > ttlMs) {
          runs.delete(runId);
        }
      }
      if (runs.size === 0) {
        this.recordsByStudioKey.delete(studioKey);
      }
    }
  }
}

export const studioAgentLeaseService = new StudioAgentLeaseService();
