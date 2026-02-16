/**
 * Types for the pre-publish checklist feature.
 * Used by the agent to validate production readiness.
 */

export type ChecklistStatus = "pass" | "fail" | "warning" | "skip" | "fixed";

export interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  note?: string; // What's missing, what needs to be done, or what was fixed
}

export interface PrePublishChecklist {
  projectSlug: string;
  version: number;
  runAt: string; // ISO timestamp
  snapshotCommitHash?: string; // Commit hash of the snapshot created before running checks
  items: ChecklistItem[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    fixed?: number; // Items marked as fixed by agent, pending re-verification
  };
}
