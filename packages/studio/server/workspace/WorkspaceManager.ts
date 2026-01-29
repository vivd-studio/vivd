import { simpleGit, SimpleGit } from "simple-git";
import fs from "fs-extra";
import path from "path";
import os from "os";

export class WorkspaceManager {
  private workspaceDir: string | null = null;
  private git: SimpleGit | null = null;
  private repoUrl: string | null = null;

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
    this.repoUrl = repoUrl;

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
      urlObj.username = token;
      urlObj.password = "";
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
  ): Promise<Array<{ hash: string; message: string; date: string }>> {
    if (!this.git) {
      return [];
    }

    const log = await this.git.log({ maxCount: limit });
    return log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
    }));
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
