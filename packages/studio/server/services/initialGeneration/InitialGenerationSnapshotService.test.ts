import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { simpleGit } from "simple-git";
import { saveInitialGenerationSnapshot } from "./InitialGenerationSnapshotService.js";

async function createRepo(): Promise<{
  repoDir: string;
  git: ReturnType<typeof simpleGit>;
}> {
  const repoDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "vivd-initial-generation-snapshot-"),
  );
  const git = simpleGit(repoDir);
  git.env({ ...process.env, GIT_TERMINAL_PROMPT: "0" });

  await git.init();
  await git.raw(["branch", "-M", "main"]);
  await git.addConfig("user.email", "test@vivd.local");
  await git.addConfig("user.name", "Vivd Test");

  await fs.writeFile(path.join(repoDir, "index.html"), "<h1>Initial</h1>\n", "utf-8");
  await git.add(".");
  await git.commit("Initial generation");

  return { repoDir, git };
}

describe("saveInitialGenerationSnapshot", () => {
  const tempDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(
      [...tempDirs].map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
    tempDirs.clear();
  });

  it("creates a completion commit when the initial-generation run changed files", async () => {
    const { repoDir, git } = await createRepo();
    tempDirs.add(repoDir);

    const before = (await git.revparse(["HEAD"])).trim();
    await fs.writeFile(path.join(repoDir, "index.html"), "<h1>Completed</h1>\n", "utf-8");

    const result = await saveInitialGenerationSnapshot(repoDir);

    const after = (await git.revparse(["HEAD"])).trim();
    const latest = await git.log({ maxCount: 1 });

    expect(result).toEqual({
      commitHash: after,
      createdCommit: true,
    });
    expect(after).not.toBe(before);
    expect(latest.latest?.message).toBe("Complete initial generation");
  });

  it("ignores the workspace marker and reuses HEAD when no real files changed", async () => {
    const { repoDir, git } = await createRepo();
    tempDirs.add(repoDir);

    const before = (await git.revparse(["HEAD"])).trim();
    await fs.writeFile(path.join(repoDir, ".vivd-working-commit"), `${before}\n`, "utf-8");

    const result = await saveInitialGenerationSnapshot(repoDir);

    const after = (await git.revparse(["HEAD"])).trim();
    const log = await git.log();

    expect(result).toEqual({
      commitHash: before,
      createdCommit: false,
    });
    expect(after).toBe(before);
    expect(log.total).toBe(1);
  });
});
