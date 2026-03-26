import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_SNAPSHOT_GIT_DIRS = [
  "refs",
  "refs/heads",
  "refs/tags",
  "branches",
  "objects/info",
  "objects/pack",
  "info",
];

async function isSnapshotGitDir(repoDir: string): Promise<boolean> {
  try {
    const [head, config, objects] = await Promise.all([
      fs.stat(path.join(repoDir, "HEAD")),
      fs.stat(path.join(repoDir, "config")),
      fs.stat(path.join(repoDir, "objects")),
    ]);
    return head.isFile() && config.isFile() && objects.isDirectory();
  } catch {
    return false;
  }
}

async function repairSnapshotGitDir(repoDir: string): Promise<void> {
  await Promise.all(
    REQUIRED_SNAPSHOT_GIT_DIRS.map((relativeDir) =>
      fs.mkdir(path.join(repoDir, relativeDir), { recursive: true }),
    ),
  );
}

export async function repairOpencodeSnapshotGitDirs(snapshotRoot: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(snapshotRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const repaired: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoDir = path.join(snapshotRoot, entry.name);
    if (!(await isSnapshotGitDir(repoDir))) continue;

    await repairSnapshotGitDir(repoDir);
    repaired.push(repoDir);
  }

  return repaired;
}

async function main() {
  const snapshotRoot = process.argv[2];
  if (!snapshotRoot) {
    console.error("Usage: node snapshotGitDirRepair.js <snapshot-root>");
    process.exit(1);
  }

  const repaired = await repairOpencodeSnapshotGitDirs(snapshotRoot);
  console.log(`[OpenCode] Repaired snapshot git directories: ${repaired.length}`);
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error("[OpenCode] Failed to repair snapshot git directories:", error);
    process.exit(1);
  });
}
