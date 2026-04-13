import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceManager } from "./WorkspaceManager.js";

type EnvSnapshot = {
  HOME: string | undefined;
  GIT_CONFIG_GLOBAL: string | undefined;
};

let envBefore: EnvSnapshot;
let tempHomeDir: string;
let tempWorkspaceDir: string;
let manager: WorkspaceManager;

beforeEach(async () => {
  envBefore = {
    HOME: process.env.HOME,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  };
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-workspace-home-"));
  process.env.HOME = tempHomeDir;
  process.env.GIT_CONFIG_GLOBAL = path.join(tempHomeDir, ".gitconfig");

  tempWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-workspace-"));
  manager = new WorkspaceManager();
  await manager.open(tempWorkspaceDir);
});

afterEach(async () => {
  await manager.cleanup();
  await fs.rm(tempWorkspaceDir, { recursive: true, force: true });
  await fs.rm(tempHomeDir, { recursive: true, force: true });

  if (typeof envBefore.HOME === "string") process.env.HOME = envBefore.HOME;
  else delete process.env.HOME;
  if (typeof envBefore.GIT_CONFIG_GLOBAL === "string") {
    process.env.GIT_CONFIG_GLOBAL = envBefore.GIT_CONFIG_GLOBAL;
  } else {
    delete process.env.GIT_CONFIG_GLOBAL;
  }
});

describe("WorkspaceManager save/discard transitions", () => {
  it("commits file changes and discards unstaged edits back to HEAD", async () => {
    const indexPath = path.join(tempWorkspaceDir, "index.html");
    await fs.writeFile(indexPath, "<h1>Version 1</h1>", "utf-8");

    const commitHash = await manager.commit("Initial content");
    expect(commitHash).toBeTruthy();
    await expect(manager.hasChanges()).resolves.toBe(false);

    await fs.writeFile(indexPath, "<h1>Draft change</h1>", "utf-8");
    await expect(manager.hasChanges()).resolves.toBe(true);

    await manager.discardChanges();
    await expect(manager.hasChanges()).resolves.toBe(false);
    await expect(fs.readFile(indexPath, "utf-8")).resolves.toBe("<h1>Version 1</h1>");
  });

  it("restores the loaded snapshot when discarding changes while pinned to an older commit", async () => {
    const indexPath = path.join(tempWorkspaceDir, "index.html");
    await fs.writeFile(indexPath, "<h1>Version 1</h1>", "utf-8");
    const firstCommit = await manager.commit("First");
    expect(firstCommit).toBeTruthy();

    await fs.writeFile(indexPath, "<h1>Version 2</h1>", "utf-8");
    const secondCommit = await manager.commit("Second");
    expect(secondCommit).toBeTruthy();

    await manager.loadVersion(firstCommit!);
    await expect(fs.readFile(indexPath, "utf-8")).resolves.toBe("<h1>Version 1</h1>");
    await expect(manager.getWorkingCommit()).resolves.toBe(firstCommit);

    await fs.writeFile(indexPath, "<h1>Transient edit</h1>", "utf-8");
    await expect(manager.hasChanges()).resolves.toBe(true);

    await manager.discardChanges();

    await expect(manager.hasChanges()).resolves.toBe(false);
    await expect(manager.getWorkingCommit()).resolves.toBe(firstCommit);
    await expect(fs.readFile(indexPath, "utf-8")).resolves.toBe("<h1>Version 1</h1>");

    const head = await manager.getHeadCommit();
    expect(head?.hash).toBe(secondCommit);
  });

  it("clears a stale working-commit marker when it points at HEAD", async () => {
    const indexPath = path.join(tempWorkspaceDir, "index.html");
    const markerPath = path.join(tempWorkspaceDir, ".vivd-working-commit");

    await fs.writeFile(indexPath, "<h1>Version 1</h1>", "utf-8");
    const headCommit = await manager.commit("Initial content");
    expect(headCommit).toBeTruthy();

    await fs.writeFile(markerPath, `${headCommit}\n`, "utf-8");

    await expect(manager.getWorkingCommit()).resolves.toBeNull();
    await expect(manager.hasChanges()).resolves.toBe(false);
    await expect(fs.stat(markerPath)).rejects.toThrow();
  });

  it("clears a stale older working-commit marker once HEAD is clean", async () => {
    const indexPath = path.join(tempWorkspaceDir, "index.html");
    const markerPath = path.join(tempWorkspaceDir, ".vivd-working-commit");

    await fs.writeFile(indexPath, "<h1>Version 1</h1>", "utf-8");
    const firstCommit = await manager.commit("First");
    expect(firstCommit).toBeTruthy();

    await fs.writeFile(indexPath, "<h1>Version 2</h1>", "utf-8");
    const secondCommit = await manager.commit("Second");
    expect(secondCommit).toBeTruthy();

    await fs.writeFile(markerPath, `${firstCommit}\n`, "utf-8");

    await expect(manager.getWorkingCommit()).resolves.toBeNull();
    await expect(manager.getChangedFiles()).resolves.toEqual([]);
    await expect(manager.hasChanges()).resolves.toBe(false);
    await expect(fs.stat(markerPath)).rejects.toThrow();
    const head = await manager.getHeadCommit();
    expect(head?.hash).toBe(secondCommit);
  });
});
