import fs from "fs-extra";
import path from "node:path";

export const LEGACY_WORKING_COMMIT_MARKER = ".vivd-working-commit";

function resolveWorkspaceDir(workspaceDir: string): string {
  return path.resolve(workspaceDir);
}

export function getLegacyWorkingCommitMarkerPath(workspaceDir: string): string {
  return path.join(resolveWorkspaceDir(workspaceDir), LEGACY_WORKING_COMMIT_MARKER);
}

export function getLoadedSnapshotStatePath(workspaceDir: string): string {
  const resolved = resolveWorkspaceDir(workspaceDir);
  const parentDir = path.dirname(resolved);
  const workspaceName = path.basename(resolved) || "workspace";
  return path.join(parentDir, `.vivd-loaded-snapshot-${workspaceName}.txt`);
}

async function readTrimmedFile(filePath: string): Promise<string | null> {
  try {
    const value = (await fs.readFile(filePath, "utf-8")).trim();
    return value || null;
  } catch {
    return null;
  }
}

export async function readLoadedSnapshotCommit(
  workspaceDir: string,
): Promise<string | null> {
  return await readTrimmedFile(getLoadedSnapshotStatePath(workspaceDir));
}

export async function hasLoadedSnapshotState(workspaceDir: string): Promise<boolean> {
  return Boolean(await readLoadedSnapshotCommit(workspaceDir));
}

export async function writeLoadedSnapshotCommit(
  workspaceDir: string,
  commitHash: string,
): Promise<void> {
  const statePath = getLoadedSnapshotStatePath(workspaceDir);
  await fs.ensureDir(path.dirname(statePath));
  await fs.writeFile(statePath, `${commitHash.trim()}\n`, "utf-8");
}

export async function clearLoadedSnapshotCommit(workspaceDir: string): Promise<void> {
  try {
    await fs.remove(getLoadedSnapshotStatePath(workspaceDir));
  } catch {
    // Ignore cleanup failures.
  }
}

export async function readLegacyWorkingCommitMarker(
  workspaceDir: string,
): Promise<string | null> {
  return await readTrimmedFile(getLegacyWorkingCommitMarkerPath(workspaceDir));
}

export async function clearLegacyWorkingCommitMarker(workspaceDir: string): Promise<void> {
  try {
    await fs.remove(getLegacyWorkingCommitMarkerPath(workspaceDir));
  } catch {
    // Ignore cleanup failures.
  }
}

export async function hasAnyLoadedSnapshotMarker(
  workspaceDir: string,
): Promise<boolean> {
  return Boolean(
    (await readLoadedSnapshotCommit(workspaceDir)) ||
      (await readLegacyWorkingCommitMarker(workspaceDir)),
  );
}
