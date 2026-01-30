import { simpleGit } from "simple-git";
import type { SimpleGit } from "simple-git";
import fs from "fs-extra";
import path from "path";
import os from "os";

export class WorkspaceManager {
  private workspaceDir: string | null = null;
  private git: SimpleGit | null = null;

  async clone(
    repoUrl: string,
    token?: string,
    branch: string = "main"
  ): Promise<void> {
    // Create temp workspace directory
    this.workspaceDir = path.join(
      os.tmpdir(),
      "vivd-studio",
      Date.now().toString()
    );
    await fs.ensureDir(this.workspaceDir);

    // Construct authenticated URL if token provided
    const authUrl = token ? this.addTokenToUrl(repoUrl, token) : repoUrl;

    // Clone repository
    this.git = simpleGit();
    await this.git.clone(authUrl, this.workspaceDir, [
      "--branch",
      branch,
      "--single-branch",
    ]);

    // Initialize git in workspace directory
    this.git = simpleGit(this.workspaceDir);

    // Configure git user for commits
    await this.git.addConfig("user.email", "studio@vivd.dev");
    await this.git.addConfig("user.name", "Vivd Studio");
  }

  private addTokenToUrl(url: string, token: string): string {
    // Handle http(s) URLs
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const urlObj = new URL(url);
      // Git smart HTTP uses Basic auth; our backend expects the session token as the password.
      // Username is ignored by the server but must be present for some git clients.
      urlObj.username = "git";
      urlObj.password = token;
      return urlObj.toString();
    }
    return url;
  }

  async commit(message: string): Promise<string | null> {
    if (!this.git || !this.workspaceDir) {
      throw new Error("Workspace not initialized");
    }

    const status = await this.git.status();
    if (status.isClean()) {
      return null;
    }

    await this.git.add(".");
    const result = await this.git.commit(message);
    return result.commit;
  }

  async push(): Promise<void> {
    if (!this.git) {
      throw new Error("Workspace not initialized");
    }

    await this.git.push("origin", "HEAD");
  }

  async hasChanges(): Promise<boolean> {
    if (!this.git) {
      return false;
    }

    const status = await this.git.status();
    return !status.isClean();
  }

  async getStatus(): Promise<{
    staged: string[];
    modified: string[];
    untracked: string[];
  }> {
    if (!this.git) {
      return { staged: [], modified: [], untracked: [] };
    }

    const status = await this.git.status();
    return {
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
    };
  }

  async discardChanges(): Promise<void> {
    if (!this.git || !this.workspaceDir) {
      throw new Error("Workspace not initialized");
    }

    // Reset staged changes
    await this.git.reset(["--hard", "HEAD"]);
    // Clean untracked files
    await this.git.clean("fd");
  }

  async getHistory(
    limit: number = 10
  ): Promise<
    Array<{
      hash: string;
      shortHash: string;
      message: string;
      date: string;
      author: string;
      parents: string[];
    }>
  > {
    if (!this.git) {
      return [];
    }

    try {
      // Format: hash|shortHash|author|date|message|parents
      const stdout = await this.git.raw([
        "log",
        "--format=%H|%h|%an|%aI|%s|%P",
        "-n",
        String(Math.max(1, limit)),
      ]);

      if (!stdout.trim()) return [];

      return stdout
        .trim()
        .split("\n")
        .map((line) => {
          const parts = line.split("|");
          if (parts.length < 6) {
            const [hash, shortHash, author, date, ...rest] = parts;
            return {
              hash: hash ?? "",
              shortHash: shortHash ?? "",
              author: author ?? "",
              date: date ?? "",
              message: rest.join("|"),
              parents: [],
            };
          }

          const hash = parts[0] ?? "";
          const shortHash = parts[1] ?? "";
          const author = parts[2] ?? "";
          const date = parts[3] ?? "";
          const parentsStr = parts[parts.length - 1] ?? "";
          const message = parts.slice(4, parts.length - 1).join("|");

          return {
            hash,
            shortHash,
            author,
            date,
            message,
            parents: parentsStr ? parentsStr.split(" ") : [],
          };
        });
    } catch {
      return [];
    }
  }

  async getHeadCommit(): Promise<{ hash: string; message: string } | null> {
    if (!this.git) return null;
    try {
      const log = await this.git.log({ maxCount: 1 });
      const latest = log.latest;
      if (!latest) return null;
      return { hash: latest.hash, message: latest.message };
    } catch {
      return null;
    }
  }

  async getTags(): Promise<string[]> {
    if (!this.git) return [];
    try {
      const stdout = await this.git.raw(["tag", "--sort=-creatordate"]);
      return stdout
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  getProjectPath(): string {
    if (!this.workspaceDir) {
      throw new Error("Workspace not initialized");
    }
    return this.workspaceDir;
  }

  isInitialized(): boolean {
    return this.workspaceDir !== null;
  }

  async cleanup(): Promise<void> {
    if (this.workspaceDir) {
      try {
        await fs.remove(this.workspaceDir);
        console.log(`Cleaned up workspace: ${this.workspaceDir}`);
      } catch (error) {
        console.error(`Failed to cleanup workspace: ${error}`);
      }
      this.workspaceDir = null;
      this.git = null;
    }
  }
}
