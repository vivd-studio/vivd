import fs from "node:fs";
import path from "node:path";

const SYNC_PAUSE_FILE_PATH =
  process.env.VIVD_SYNC_PAUSE_FILE || "/tmp/vivd-sync.pause";

export type BucketSyncPauseLease = {
  release: () => void;
};

function touchPauseFile(): { existed: boolean; mtimeMs: number | null } {
  try {
    const existed = fs.existsSync(SYNC_PAUSE_FILE_PATH);
    if (!existed) {
      fs.mkdirSync(path.dirname(SYNC_PAUSE_FILE_PATH), { recursive: true });
      fs.writeFileSync(SYNC_PAUSE_FILE_PATH, "1", "utf-8");
    } else {
      const now = new Date();
      fs.utimesSync(SYNC_PAUSE_FILE_PATH, now, now);
    }

    const stat = fs.statSync(SYNC_PAUSE_FILE_PATH);
    return { existed, mtimeMs: stat.mtimeMs };
  } catch {
    return { existed: false, mtimeMs: null };
  }
}

export function acquireBucketSyncPause(): BucketSyncPauseLease {
  const { existed, mtimeMs } = touchPauseFile();

  return {
    release: () => {
      try {
        if (existed) return;
        if (!fs.existsSync(SYNC_PAUSE_FILE_PATH)) return;
        if (mtimeMs !== null) {
          const stat = fs.statSync(SYNC_PAUSE_FILE_PATH);
          // If another subsystem touched the pause file after we created it, don't remove it.
          if (stat.mtimeMs > mtimeMs + 1) return;
        }
        fs.rmSync(SYNC_PAUSE_FILE_PATH, { force: true });
      } catch {
        // Best-effort only.
      }
    },
  };
}

export async function withBucketSyncPaused<T>(fn: () => Promise<T>): Promise<T> {
  const lease = acquireBucketSyncPause();
  try {
    return await fn();
  } finally {
    lease.release();
  }
}

