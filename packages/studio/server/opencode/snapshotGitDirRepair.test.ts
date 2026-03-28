import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { repairOpencodeSnapshotGitDirs } from "./snapshotGitDirRepair.js";

function runGit(args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  const result = spawnSync("git", args, {
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }

  return (result.stdout || "").trim();
}

describe("repairOpencodeSnapshotGitDirs", () => {
  it("recreates empty git directories lost during object-storage hydration", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-opencode-snapshot-repair-"));
    const repoDir = path.join(tmpRoot, "repo");
    const snapshotRoot = path.join(tmpRoot, "snapshot");
    const snapshotGitDir = path.join(snapshotRoot, "project-id");

    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(snapshotGitDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "index.html"), "<h1>before</h1>\n", "utf-8");

    runGit(["init"], { cwd: repoDir });
    runGit(["config", "user.email", "studio@vivd.local"], { cwd: repoDir });
    runGit(["config", "user.name", "Vivd Studio"], { cwd: repoDir });
    runGit(["add", "index.html"], { cwd: repoDir });
    runGit(["commit", "-m", "init"], { cwd: repoDir });

    runGit(["init"], {
      env: {
        GIT_DIR: snapshotGitDir,
        GIT_WORK_TREE: repoDir,
      },
    });
    runGit(["--git-dir", snapshotGitDir, "--work-tree", repoDir, "add", "."], { cwd: repoDir });
    expect(
      runGit(["--git-dir", snapshotGitDir, "--work-tree", repoDir, "write-tree"], { cwd: repoDir }),
    ).toMatch(/^[0-9a-f]{40}$/);

    await fs.rm(path.join(snapshotGitDir, "refs"), { recursive: true, force: true });
    await fs.rm(path.join(snapshotGitDir, "branches"), { recursive: true, force: true });

    const broken = spawnSync(
      "git",
      ["--git-dir", snapshotGitDir, "--work-tree", repoDir, "write-tree"],
      {
        cwd: repoDir,
        env: process.env,
        encoding: "utf-8",
      },
    );
    expect(broken.status).not.toBe(0);

    const result = await repairOpencodeSnapshotGitDirs(snapshotRoot, repoDir);
    expect(result.repaired).toEqual([snapshotGitDir]);
    expect(result.rebuilt).toEqual([]);

    expect(
      runGit(["--git-dir", snapshotGitDir, "--work-tree", repoDir, "write-tree"], { cwd: repoDir }),
    ).toMatch(/^[0-9a-f]{40}$/);
  });

  it("rebuilds the current project's snapshot gitdir when the object store is already incomplete", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-opencode-snapshot-rebuild-"));
    const repoDir = path.join(tmpRoot, "repo");
    const snapshotRoot = path.join(tmpRoot, "snapshot");
    const snapshotGitDir = path.join(snapshotRoot, "project-id");

    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(snapshotGitDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "index.html"), "<h1>before</h1>\n", "utf-8");

    runGit(["init"], { cwd: repoDir });
    runGit(["config", "user.email", "studio@vivd.local"], { cwd: repoDir });
    runGit(["config", "user.name", "Vivd Studio"], { cwd: repoDir });
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(repoDir, ".git", "opencode"), "project-id\n", "utf-8");

    runGit(["init"], {
      env: {
        GIT_DIR: snapshotGitDir,
        GIT_WORK_TREE: repoDir,
      },
    });
    runGit(["--git-dir", snapshotGitDir, "--work-tree", repoDir, "add", "."], { cwd: repoDir });
    expect(
      runGit(["--git-dir", snapshotGitDir, "--work-tree", repoDir, "write-tree"], { cwd: repoDir }),
    ).toMatch(/^[0-9a-f]{40}$/);

    await fs.rm(path.join(snapshotGitDir, "objects"), { recursive: true, force: true });
    await fs.mkdir(path.join(snapshotGitDir, "objects", "info"), { recursive: true });
    await fs.mkdir(path.join(snapshotGitDir, "objects", "pack"), { recursive: true });

    const broken = spawnSync(
      "git",
      ["--git-dir", snapshotGitDir, "--work-tree", repoDir, "write-tree"],
      {
        cwd: repoDir,
        env: process.env,
        encoding: "utf-8",
      },
    );
    expect(broken.status).not.toBe(0);

    const result = await repairOpencodeSnapshotGitDirs(snapshotRoot, repoDir);
    expect(result.repaired).toEqual([snapshotGitDir]);
    expect(result.rebuilt).toEqual([snapshotGitDir]);

    runGit(["--git-dir", snapshotGitDir, "--work-tree", repoDir, "add", "."], { cwd: repoDir });
    expect(
      runGit(["--git-dir", snapshotGitDir, "--work-tree", repoDir, "write-tree"], { cwd: repoDir }),
    ).toMatch(/^[0-9a-f]{40}$/);
  });

  it("initializes the current project's snapshot gitdir when hydration restored only an empty placeholder directory", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-opencode-snapshot-init-"));
    const repoDir = path.join(tmpRoot, "repo");
    const snapshotRoot = path.join(tmpRoot, "snapshot");
    const snapshotGitDir = path.join(snapshotRoot, "project-id");

    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(path.join(snapshotGitDir, "info"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "index.html"), "<h1>before</h1>\n", "utf-8");

    runGit(["init"], { cwd: repoDir });
    runGit(["config", "user.email", "studio@vivd.local"], { cwd: repoDir });
    runGit(["config", "user.name", "Vivd Studio"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, ".git", "opencode"), "project-id\n", "utf-8");

    const result = await repairOpencodeSnapshotGitDirs(snapshotRoot, repoDir);
    expect(result.repaired).toEqual([snapshotGitDir]);
    expect(result.rebuilt).toEqual([snapshotGitDir]);

    runGit(["--git-dir", snapshotGitDir, "--work-tree", repoDir, "add", "."], { cwd: repoDir });
    expect(
      runGit(["--git-dir", snapshotGitDir, "--work-tree", repoDir, "write-tree"], { cwd: repoDir }),
    ).toMatch(/^[0-9a-f]{40}$/);
  });
});
