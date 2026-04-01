import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { ensureGitRepositoryHasInitialCommit } from "../src/generator/gitUtils";

describe("ensureGitRepositoryHasInitialCommit", () => {
  it("creates a repository and initial commit for a plain directory", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-git-utils-"));
    fs.writeFileSync(path.join(cwd, "index.html"), "<h1>Hello</h1>\n");

    await ensureGitRepositoryHasInitialCommit(cwd, "Initial generation");

    await expect(execa("git", ["rev-parse", "--verify", "HEAD"], { cwd })).resolves.toMatchObject({
      stdout: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    await expect(execa("git", ["branch", "--show-current"], { cwd })).resolves.toMatchObject({
      stdout: "main",
    });
  });

  it("creates the first commit for an unborn repository", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-git-utils-"));
    fs.writeFileSync(path.join(cwd, "index.html"), "<h1>Hello</h1>\n");
    await execa("git", ["init"], { cwd });
    await execa("git", ["branch", "-M", "main"], { cwd });

    await ensureGitRepositoryHasInitialCommit(cwd, "Initial generation");

    await expect(execa("git", ["rev-parse", "--verify", "HEAD"], { cwd })).resolves.toMatchObject({
      stdout: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    await expect(execa("git", ["status", "--short"], { cwd })).resolves.toMatchObject({
      stdout: "",
    });
  });

  it("does not create an extra commit when HEAD already exists", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-git-utils-"));
    fs.writeFileSync(path.join(cwd, "index.html"), "<h1>Hello</h1>\n");

    await ensureGitRepositoryHasInitialCommit(cwd, "Initial generation");
    const before = await execa("git", ["rev-parse", "--verify", "HEAD"], { cwd });

    const created = await ensureGitRepositoryHasInitialCommit(cwd, "Initial generation");
    const after = await execa("git", ["rev-parse", "--verify", "HEAD"], { cwd });

    expect(created).toBe(false);
    expect(after.stdout).toBe(before.stdout);
  });
});
