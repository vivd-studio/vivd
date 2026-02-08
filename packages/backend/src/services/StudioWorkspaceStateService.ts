type StudioWorkspaceStateRecord = {
  studioId: string;
  slug: string;
  version: number;
  hasUnsavedChanges: boolean;
  headCommitHash: string | null;
  workingCommitHash: string | null;
  reportedAtMs: number;
};

type ReportWorkspaceStateInput = {
  studioId: string;
  slug: string;
  version: number;
  hasUnsavedChanges: boolean;
  headCommitHash?: string | null;
  workingCommitHash?: string | null;
};

type RecentWorkspaceState = {
  studioId: string;
  slug: string;
  version: number;
  hasUnsavedChanges: boolean;
  headCommitHash: string | null;
  workingCommitHash: string | null;
  reportedAt: Date;
  isFresh: boolean;
};

const DEFAULT_STUDIO_STATE_MAX_AGE_MS = 30_000;
const CLEANUP_FACTOR = 6;

function keyFor(slug: string, version: number): string {
  return `${slug}:v${version}`;
}

class StudioWorkspaceStateService {
  private records = new Map<string, StudioWorkspaceStateRecord>();

  report(input: ReportWorkspaceStateInput): void {
    const now = Date.now();
    const key = keyFor(input.slug, input.version);

    this.records.set(key, {
      studioId: input.studioId,
      slug: input.slug,
      version: input.version,
      hasUnsavedChanges: input.hasUnsavedChanges,
      headCommitHash: input.headCommitHash ?? null,
      workingCommitHash: input.workingCommitHash ?? null,
      reportedAtMs: now,
    });

    this.cleanup(now);
  }

  getRecent(slug: string, version: number): RecentWorkspaceState | null {
    const key = keyFor(slug, version);
    const record = this.records.get(key);
    if (!record) return null;

    const maxAgeMs = this.maxAgeMs();
    const ageMs = Date.now() - record.reportedAtMs;
    const isFresh = ageMs >= 0 && ageMs <= maxAgeMs;

    return {
      studioId: record.studioId,
      slug: record.slug,
      version: record.version,
      hasUnsavedChanges: record.hasUnsavedChanges,
      headCommitHash: record.headCommitHash,
      workingCommitHash: record.workingCommitHash,
      reportedAt: new Date(record.reportedAtMs),
      isFresh,
    };
  }

  clearByStudio(studioId: string): void {
    if (!studioId) return;
    for (const [key, record] of this.records.entries()) {
      if (record.studioId === studioId) {
        this.records.delete(key);
      }
    }
  }

  private cleanup(nowMs: number): void {
    const ttlMs = this.maxAgeMs() * CLEANUP_FACTOR;
    for (const [key, record] of this.records.entries()) {
      if (nowMs - record.reportedAtMs > ttlMs) {
        this.records.delete(key);
      }
    }
  }

  private maxAgeMs(): number {
    const raw = process.env.STUDIO_STATE_MAX_AGE_MS;
    const parsed = Number.parseInt(raw || "", 10);
    if (Number.isFinite(parsed) && parsed > 1_000) return parsed;
    return DEFAULT_STUDIO_STATE_MAX_AGE_MS;
  }
}

export const studioWorkspaceStateService = new StudioWorkspaceStateService();
