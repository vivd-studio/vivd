export interface ConnectedProjectListRow {
  slug: string;
  status: string;
  url: string | null;
  source: "url" | "scratch";
  title: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  totalVersions: number;
  versions: Array<{ version: number; status: string }>;
  publishedDomain: string | null;
  publishedVersion: number | null;
  thumbnailUrl: string | null;
  publicPreviewEnabled?: boolean;
  enabledPlugins?: string[];
}

export type ConnectedPublishState = {
  storageEnabled: boolean;
  readiness: "ready" | "build_in_progress" | "artifact_not_ready" | string;
  sourceKind: string;
  framework: string;
  publishableCommitHash: string | null;
  lastSyncedCommitHash: string | null;
  builtAt: string | null;
  sourceBuiltAt: string | null;
  previewBuiltAt: string | null;
  error: string | null;
  studioRunning: boolean;
  studioStateAvailable: boolean;
  studioHasUnsavedChanges: boolean;
  studioHeadCommitHash: string | null;
  studioWorkingCommitHash: string | null;
  studioStateReportedAt: string | null;
};

export type ConnectedPublishChecklist = {
  checklist: {
    summary: {
      passed: number;
      failed: number;
      warnings: number;
      skipped: number;
      fixed?: number;
    };
    items: Array<unknown>;
  } | null;
  stale: boolean;
  reason: "missing" | "project_updated" | "hash_mismatch" | null;
};

export type ConnectedCheckDomainResult = {
  available: boolean;
  normalizedDomain: string;
  error?: string;
};

export type ConnectedPublishTargetsResult = {
  projectSlug: string;
  currentPublishedDomain: string | null;
  recommendedDomain: string | null;
  targets: Array<{
    domain: string;
    usage: "tenant_host" | "publish_target";
    type: "managed_subdomain" | "custom_domain" | "implicit_primary_host";
    status: "active" | "disabled" | "pending_verification" | "implicit";
    current: boolean;
    primaryHost: boolean;
    available: boolean;
    blockedReason?: string;
    url: string;
    recommended: boolean;
  }>;
};
