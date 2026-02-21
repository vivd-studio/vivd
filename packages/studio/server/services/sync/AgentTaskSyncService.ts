import fs from "node:fs";
import path from "node:path";

const DEFAULT_SYNC_TRIGGER_FILE = "/tmp/vivd-sync.trigger";

function hasBucketSyncConfigured(): boolean {
  return Boolean(
    (process.env.VIVD_S3_SOURCE_URI || "").trim() ||
      (process.env.VIVD_S3_OPENCODE_URI || "").trim() ||
      (process.env.VIVD_S3_OPENCODE_STORAGE_URI || "").trim() ||
      (process.env.VIVD_S3_BUCKET || "").trim() ||
      (process.env.R2_BUCKET || "").trim(),
  );
}

function getSyncTriggerFilePath(): string {
  return (process.env.VIVD_SYNC_TRIGGER_FILE || DEFAULT_SYNC_TRIGGER_FILE).trim();
}

export function requestBucketSync(
  reason: string,
  details: Record<string, unknown> = {},
): boolean {
  if (!hasBucketSyncConfigured()) return false;

  const triggerPath = getSyncTriggerFilePath();
  if (!triggerPath) return false;

  try {
    fs.mkdirSync(path.dirname(triggerPath), { recursive: true });
    fs.writeFileSync(
      triggerPath,
      JSON.stringify(
        {
          reason,
          ...details,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Artifacts] Failed to request bucket sync (${reason}): ${message}`);
    return false;
  }
}

export function requestBucketSyncAfterAgentTask(options: {
  sessionId: string;
  projectDir: string;
}): boolean {
  return requestBucketSync("agent-task-completed", options);
}
