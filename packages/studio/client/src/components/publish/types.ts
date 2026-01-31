export type ChecklistStatus = "pass" | "fail" | "warning" | "skip" | "fixed";

export interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  note?: string;
}

export interface PrePublishChecklist {
  projectSlug: string;
  version: number;
  runAt: string;
  items: ChecklistItem[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    fixed?: number;
  };
}

export interface PreviewChecklistItem {
  id: string;
  label: string;
}
