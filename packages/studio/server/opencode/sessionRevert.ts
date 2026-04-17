import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { serverManager } from "./serverManager.js";
import {
  resolveOpencodeSnapshotGitState,
  snapshotGitDirHasObject,
} from "./snapshotGitDirRepair.js";
import {
  normalizeDetailedSessionDiffs,
  readSessionString,
  type SessionMessageRecord,
} from "./sessionMessageUtils.js";

type RevertPatchPartRecord = {
  type?: unknown;
  files?: unknown;
  hash?: unknown;
};

type RevertPatchHistory = {
  files: string[];
  hashes: string[];
};

function getPatchHistoryForMessageRevert(
  messages: SessionMessageRecord[],
  userMessageId: string,
): RevertPatchHistory {
  const files = new Set<string>();
  const hashes = new Set<string>();
  let collect = false;

  for (const message of messages) {
    const messageId = readSessionString(message?.info?.id);
    if (!collect) {
      if (messageId !== userMessageId) {
        continue;
      }
      collect = true;
      continue;
    }

    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (const part of parts as RevertPatchPartRecord[]) {
      if (part?.type !== "patch") {
        continue;
      }

      const patchFiles = Array.isArray(part.files) ? part.files : [];
      for (const file of patchFiles) {
        if (typeof file === "string" && file.trim().length > 0) {
          files.add(file);
        }
      }

      if (typeof part.hash === "string" && part.hash.trim().length > 0) {
        hashes.add(part.hash);
      }
    }
  }

  return {
    files: [...files],
    hashes: [...hashes],
  };
}

function normalizeUnifiedDiffPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/dev/null") {
    return null;
  }

  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }

  return trimmed;
}

function getTrackedFilesFromUnifiedDiff(diffText: string | undefined): string[] {
  if (!diffText) {
    return [];
  }

  const files = new Set<string>();
  for (const line of diffText.split(/\r?\n/)) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch) {
      const file = normalizeUnifiedDiffPath(diffMatch[2] ?? diffMatch[1] ?? "");
      if (file) {
        files.add(file);
      }
      continue;
    }

    const plusMatch = line.match(/^\+\+\+ (.+)$/);
    if (plusMatch) {
      const file = normalizeUnifiedDiffPath(plusMatch[1] ?? "");
      if (file) {
        files.add(file);
      }
      continue;
    }

    const minusMatch = line.match(/^--- (.+)$/);
    if (minusMatch) {
      const file = normalizeUnifiedDiffPath(minusMatch[1] ?? "");
      if (file) {
        files.add(file);
      }
    }
  }

  return [...files];
}

function resolveTrackedFilePath(worktree: string, file: string): string {
  return path.isAbsolute(file) ? file : path.join(worktree, file);
}

async function fingerprintTrackedFile(
  worktree: string,
  file: string,
): Promise<string> {
  const target = resolveTrackedFilePath(worktree, file);
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      return `symlink:${await fs.readlink(target)}`;
    }
    if (!stat.isFile()) {
      return `type:${stat.mode.toString(8)}`;
    }

    const content = await fs.readFile(target);
    return `file:${crypto.createHash("sha1").update(content).digest("hex")}`;
  } catch (error) {
    const code =
      typeof error === "object" &&
      error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "unknown";
    return `missing:${code}`;
  }
}

async function captureTrackedFileFingerprints(
  worktree: string,
  files: string[],
): Promise<Map<string, string>> {
  const pairs = await Promise.all(
    files.map(async (file) => [file, await fingerprintTrackedFile(worktree, file)] as const),
  );
  return new Map(pairs);
}

function didTrackedFileFingerprintsChange(
  before: Map<string, string>,
  after: Map<string, string>,
): boolean {
  for (const [file, fingerprint] of before) {
    if (after.get(file) !== fingerprint) {
      return true;
    }
  }
  return false;
}

async function getMissingSnapshotHashes(
  directory: string,
  hashes: string[],
): Promise<string[]> {
  if (!hashes.length) {
    return [];
  }

  const snapshotState = await resolveOpencodeSnapshotGitState(directory);
  if (!snapshotState) {
    return [];
  }

  return hashes.filter(
    (hash) =>
      !snapshotGitDirHasObject(
        snapshotState.snapshotGitDir,
        snapshotState.worktree,
        hash,
      ),
  );
}

export async function getMessageDiff(
  sessionId: string,
  messageId: string,
  directory: string,
) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const messagesResult = await client.session.messages({
    sessionID: sessionId,
    directory: opencodeDir,
  });

  if (messagesResult.error) {
    throw new Error(
      `Failed to load session messages for diff lookup: ${JSON.stringify(messagesResult.error)}`,
    );
  }

  const messages = Array.isArray(messagesResult.data) ? messagesResult.data : [];
  const targetMessage = messages.find(
    (message) =>
      (message &&
        typeof message === "object" &&
        typeof (message as any).info?.id === "string" &&
        (message as any).info.id === messageId) ||
      (typeof (message as any)?.id === "string" && (message as any).id === messageId),
  );
  const summaryDiffs = normalizeDetailedSessionDiffs(
    (targetMessage as any)?.info?.summary?.diffs ?? (targetMessage as any)?.summary?.diffs,
  );

  if (summaryDiffs.length > 0) {
    return summaryDiffs;
  }

  const result = await client.session.diff({
    sessionID: sessionId,
    directory: opencodeDir,
    messageID: messageId,
  });

  if (result.error) {
    throw new Error(`Failed to load session diff: ${JSON.stringify(result.error)}`);
  }

  return normalizeDetailedSessionDiffs(result.data);
}

export async function revertToUserMessage(
  sessionId: string,
  userMessageId: string,
  directory: string,
) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);

  let patchHistory: RevertPatchHistory = { files: [], hashes: [] };
  let priorRevertMessageId: string | undefined;
  const trackedFileFingerprintsBefore = await captureTrackedFileFingerprints(
    directory,
    patchHistory.files,
  );
  try {
    const messagesRes = await client.session.messages({
      sessionID: sessionId,
      directory: opencodeDir,
    });
    if (!messagesRes.error && Array.isArray(messagesRes.data)) {
      patchHistory = getPatchHistoryForMessageRevert(
        messagesRes.data as SessionMessageRecord[],
        userMessageId,
      );
    }
  } catch {
    // Best-effort only.
  }
  const trackedFilesBefore =
    patchHistory.files.length > 0
      ? await captureTrackedFileFingerprints(directory, patchHistory.files)
      : trackedFileFingerprintsBefore;

  const missingSnapshotHashes = await getMissingSnapshotHashes(
    directory,
    patchHistory.hashes,
  );
  if (missingSnapshotHashes.length > 0) {
    console.warn(
      `[OpenCode][revert] missing snapshot history for session=${sessionId} message=${userMessageId} missingHashes=${missingSnapshotHashes.length}`,
    );
    return {
      reverted: false,
      reason: "missing_snapshot_history" as const,
      messageId: userMessageId,
      trackedFiles: patchHistory.files.slice(0, 50),
    };
  }

  try {
    const before = await client.session.get({
      sessionID: sessionId,
      directory: opencodeDir,
    });
    priorRevertMessageId = readSessionString(before.data?.revert?.messageID);
  } catch {
    // Best-effort only.
  }

  const result = await client.session.revert({
    sessionID: sessionId,
    directory: opencodeDir,
    messageID: userMessageId,
  });

  if (result.error) {
    throw new Error(`Revert failed: ${JSON.stringify(result.error)}`);
  }

  const afterRevertMessageId = readSessionString(result.data?.revert?.messageID);
  const revertDiff =
    typeof result.data?.revert?.diff === "string" ? result.data.revert.diff : undefined;
  const trackedFilesFromResult = getTrackedFilesFromUnifiedDiff(revertDiff);
  const trackedFilesAfter =
    patchHistory.files.length > 0
      ? await captureTrackedFileFingerprints(directory, patchHistory.files)
      : trackedFilesBefore;
  const revertedByMetadata =
    afterRevertMessageId === userMessageId &&
    priorRevertMessageId !== afterRevertMessageId;
  const revertedByWorkspaceChange = didTrackedFileFingerprintsChange(
    trackedFilesBefore,
    trackedFilesAfter,
  );
  const reverted = revertedByMetadata || revertedByWorkspaceChange;
  const trackedFiles = reverted
    ? trackedFilesFromResult.length > 0
      ? trackedFilesFromResult
      : patchHistory.files
    : [];

  if (!reverted) {
    console.warn(
      `[OpenCode][revert] no-op session=${sessionId} message=${userMessageId} revertBefore=${priorRevertMessageId || "none"} revertAfter=${afterRevertMessageId || "none"}`,
    );
  }

  return {
    reverted,
    messageId: userMessageId,
    trackedFiles: trackedFiles.slice(0, 50),
  };
}
