import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const REQUIRED_SNAPSHOT_GIT_DIRS = [
  "refs",
  "refs/heads",
  "refs/tags",
  "branches",
  "objects/info",
  "objects/pack",
  "info",
];

const SNAPSHOT_GIT_CONFIG = [
  ["config", "core.autocrlf", "false"],
  ["config", "core.longpaths", "true"],
  ["config", "core.symlinks", "true"],
  ["config", "core.fsmonitor", "false"],
] as const;

export type SnapshotGitRepairResult = {
  repaired: string[];
  rebuilt: string[];
};

export type SnapshotGitState = {
  projectId: string;
  worktree: string;
  snapshotRoot: string;
  snapshotProjectDir: string;
  snapshotGitDir: string;
};

function runGit(
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) {
  return spawnSync("git", args, {
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
    encoding: "utf-8",
  });
}

function resolveDefaultSnapshotRoot(): string {
  const xdgDataHome = (process.env.XDG_DATA_HOME || "").trim();
  const dataHome = xdgDataHome || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "snapshot");
}

function hashSnapshotWorktree(worktree: string): string {
  return crypto.createHash("sha1").update(worktree).digest("hex");
}

export function resolveSnapshotGitDirPath(
  snapshotRoot: string,
  projectId: string,
  worktree: string,
): string {
  return path.join(snapshotRoot, projectId, hashSnapshotWorktree(worktree));
}

async function resolveGitPaths(
  directory: string,
): Promise<{ gitDir: string; worktree: string } | null> {
  const worktreeResult = runGit(["rev-parse", "--show-toplevel"], { cwd: directory });
  const gitDirResult = runGit(["rev-parse", "--absolute-git-dir"], {
    cwd: directory,
  });
  if (worktreeResult.status !== 0 || gitDirResult.status !== 0) {
    return null;
  }

  const worktree = (worktreeResult.stdout || "").trim();
  const gitDir = (gitDirResult.stdout || "").trim();
  if (!worktree || !gitDir) {
    return null;
  }

  return { gitDir, worktree };
}

export async function resolveOpencodeSnapshotGitState(
  directory: string,
  snapshotRoot = resolveDefaultSnapshotRoot(),
): Promise<SnapshotGitState | null> {
  const gitPaths = await resolveGitPaths(directory);
  if (!gitPaths) {
    return null;
  }

  const projectId = (
    await fs.readFile(path.join(gitPaths.gitDir, "opencode"), "utf-8").catch(() => "")
  ).trim();
  if (!projectId) {
    return null;
  }

  const snapshotProjectDir = path.join(snapshotRoot, projectId);
  return {
    projectId,
    worktree: gitPaths.worktree,
    snapshotRoot,
    snapshotProjectDir,
    snapshotGitDir: resolveSnapshotGitDirPath(
      snapshotRoot,
      projectId,
      gitPaths.worktree,
    ),
  };
}

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

async function ensureSnapshotGitDirStructure(repoDir: string): Promise<void> {
  await Promise.all(
    REQUIRED_SNAPSHOT_GIT_DIRS.map((relativeDir) =>
      fs.mkdir(path.join(repoDir, relativeDir), { recursive: true }),
    ),
  );
}

async function listSnapshotGitDirCandidates(snapshotRoot: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(snapshotRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectDir = path.join(snapshotRoot, entry.name);
    candidates.push(projectDir);

    const nestedEntries = await fs
      .readdir(projectDir, { withFileTypes: true })
      .catch(() => [] as Dirent[]);
    for (const nestedEntry of nestedEntries) {
      if (!nestedEntry.isDirectory()) continue;
      candidates.push(path.join(projectDir, nestedEntry.name));
    }
  }

  return candidates;
}

export function snapshotGitDirHasObject(
  snapshotGitDir: string,
  worktree: string,
  hash: string,
): boolean {
  const trimmedHash = hash.trim();
  if (!trimmedHash) {
    return false;
  }

  const result = runGit(
    ["--git-dir", snapshotGitDir, "--work-tree", worktree, "cat-file", "-e", trimmedHash],
    { cwd: worktree },
  );
  return result.status === 0;
}

function snapshotGitDirCanWriteTree(
  snapshotGitDir: string,
  worktree: string,
): boolean {
  const result = runGit(
    ["--git-dir", snapshotGitDir, "--work-tree", worktree, "write-tree"],
    { cwd: worktree },
  );
  const hash = (result.stdout || "").trim();
  return result.status === 0 && /^[0-9a-f]{40}$/.test(hash);
}

async function initializeSnapshotGitDir(
  snapshotGitDir: string,
  worktree: string,
): Promise<void> {
  await fs.rm(snapshotGitDir, { recursive: true, force: true });
  await fs.mkdir(snapshotGitDir, { recursive: true });

  const initResult = runGit(["init"], {
    env: {
      GIT_DIR: snapshotGitDir,
      GIT_WORK_TREE: worktree,
    },
  });
  if (initResult.status !== 0) {
    throw new Error(initResult.stderr || initResult.stdout || "Failed to init snapshot gitdir");
  }

  for (const args of SNAPSHOT_GIT_CONFIG) {
    const configResult = runGit(["--git-dir", snapshotGitDir, ...args]);
    if (configResult.status !== 0) {
      throw new Error(
        configResult.stderr ||
          configResult.stdout ||
          `Failed to configure snapshot gitdir: ${args.join(" ")}`,
      );
    }
  }

  await ensureSnapshotGitDirStructure(snapshotGitDir);
  if (!snapshotGitDirCanWriteTree(snapshotGitDir, worktree)) {
    throw new Error("Reinitialized snapshot gitdir is still not writable");
  }
}

export async function repairOpencodeSnapshotGitDirs(
  snapshotRoot: string,
  directory?: string,
): Promise<SnapshotGitRepairResult> {
  const candidates = await listSnapshotGitDirCandidates(snapshotRoot);
  const currentProject = directory
    ? await resolveOpencodeSnapshotGitState(directory, snapshotRoot)
    : null;
  const repaired: string[] = [];
  const rebuilt: string[] = [];
  const seen = new Set<string>();

  for (const repoDir of candidates) {
    if (!(await isSnapshotGitDir(repoDir))) continue;

    await ensureSnapshotGitDirStructure(repoDir);
    if (
      currentProject &&
      repoDir === currentProject.snapshotGitDir &&
      !snapshotGitDirCanWriteTree(repoDir, currentProject.worktree)
    ) {
      await initializeSnapshotGitDir(repoDir, currentProject.worktree);
      rebuilt.push(repoDir);
    }

    repaired.push(repoDir);
    seen.add(repoDir);
  }

  if (currentProject && !seen.has(currentProject.snapshotGitDir)) {
    await initializeSnapshotGitDir(
      currentProject.snapshotGitDir,
      currentProject.worktree,
    );
    repaired.push(currentProject.snapshotGitDir);
    rebuilt.push(currentProject.snapshotGitDir);
  }

  return { repaired, rebuilt };
}

export async function runSnapshotGitDirRepairCli(options?: {
  argv?: string[];
  io?: Pick<typeof console, "log" | "error">;
  repair?: typeof repairOpencodeSnapshotGitDirs;
}): Promise<number> {
  const argv = options?.argv ?? process.argv;
  const io = options?.io ?? console;
  const repair = options?.repair ?? repairOpencodeSnapshotGitDirs;

  const snapshotRoot = argv[2];
  const directory = argv[3];
  if (!snapshotRoot) {
    io.error("Usage: node snapshotGitDirRepairCli.js <snapshot-root> [directory]");
    return 1;
  }

  try {
    const result = await repair(snapshotRoot, directory);
    io.log(
      `[OpenCode] Repaired snapshot git directories: ${result.repaired.length} (rebuilt ${result.rebuilt.length})`,
    );
    return 0;
  } catch (error) {
    io.error("[OpenCode] Failed to repair snapshot git directories:", error);
    return 1;
  }
}
