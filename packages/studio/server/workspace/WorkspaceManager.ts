import { simpleGit } from "simple-git";
import type { SimpleGit } from "simple-git";
import fs from "fs-extra";
import path from "path";
import os from "os";

const WORKING_COMMIT_MARKER = ".vivd-working-commit";

export class WorkspaceManager {
  private workspaceDir: string | null = null;
  private git: SimpleGit | null = null;
  private workspaceOwned = false;
  private configuredSafeDirectories = new Set<string>();

  async open(directory: string): Promise<void> {
    this.workspaceDir = path.resolve(directory);
    this.workspaceOwned = false;
    await fs.ensureDir(this.workspaceDir);

    await this.ensureSafeDirectory(this.workspaceDir);
    this.git = simpleGit(this.workspaceDir);

    let isRepo = false;
    try {
      isRepo = await this.git.checkIsRepo();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("detected dubious ownership")) {
        await this.ensureSafeDirectory(this.workspaceDir);
        isRepo = await this.git.checkIsRepo();
      } else {
        throw err;
      }
    }
    if (!isRepo) {
      await this.git.init();
      // Ensure branch name is stable for downstream tooling.
      await this.git.raw(["branch", "-M", "main"]);
    }

    // Configure git user for commits
    await this.git.addConfig("user.email", "studio@vivd.dev");
    await this.git.addConfig("user.name", "Vivd Studio");
  }

  private async ensureSafeDirectory(directory: string): Promise<void> {
    const resolved = path.resolve(directory);
    if (this.configuredSafeDirectories.has(resolved)) return;

    const git = simpleGit();
    try {
      const existing = await git.raw([
        "config",
        "--global",
        "--get-all",
        "safe.directory",
      ]);

      const alreadyConfigured = existing
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .includes(resolved);

      if (alreadyConfigured) {
        this.configuredSafeDirectories.add(resolved);
        return;
      }
    } catch {
      // Ignore config read failures; we'll still try to add the entry.
    }

    try {
      await git.raw(["config", "--global", "--add", "safe.directory", resolved]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Git] Failed to configure safe.directory for ${resolved}: ${message}`
      );
    }

    this.configuredSafeDirectories.add(resolved);
  }

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
    this.workspaceOwned = true;

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

  private normalizeGitPath(filePath: string): string {
    return filePath.trim().replaceAll("\\", "/");
  }

  private isIgnoredWorkspacePath(filePath: string): boolean {
    const normalized = this.normalizeGitPath(filePath);
    if (!normalized) return true;
    if (normalized === WORKING_COMMIT_MARKER) return true;
    if (normalized.startsWith(".astro/")) return true;
    if (normalized.startsWith("dist/")) return true;
    return false;
  }

  private getRelevantPaths(output: string): string[] {
    return output
      .trim()
      .split("\n")
      .map((entry) => this.normalizeGitPath(entry))
      .filter((entry) => entry && !this.isIgnoredWorkspacePath(entry));
  }

  private getRelevantStatusLines(statusOutput: string): string[] {
    return statusOutput
      .trim()
      .split("\n")
      .filter((line) => {
        if (!line) return false;
        const statusPath = this.normalizeGitPath(line.slice(3));
        if (!statusPath) return false;
        if (statusPath.includes(" -> ")) {
          const [fromPath, toPath] = statusPath.split(" -> ").map((p) => p.trim());
          return !(
            this.isIgnoredWorkspacePath(fromPath) &&
            this.isIgnoredWorkspacePath(toPath)
          );
        }
        return !this.isIgnoredWorkspacePath(statusPath);
      });
  }

  async commit(message: string): Promise<string | null> {
    if (!this.git || !this.workspaceDir) {
      throw new Error("Workspace not initialized");
    }

    // Stage all changes
    await this.git.raw(["add", "-A"]);

    // Ensure our internal marker file is never committed and doesn't count as a "change"
    try {
      await this.git.raw(["reset", "HEAD", WORKING_COMMIT_MARKER]);
    } catch {
      // Ignore if file isn't staged or doesn't exist
    }

    // Only commit if there are staged changes
    const staged = await this.git.raw(["diff", "--cached", "--name-only"]);
    if (!staged.trim()) {
      return null;
    }

    const result = await this.git.commit(message);

    // We're now on a new HEAD commit; clear the working-commit marker.
    await this.clearWorkingCommit();

    return result.commit;
  }

  async hasChanges(): Promise<boolean> {
    if (!this.git) {
      return false;
    }

    const workingCommit = await this.getWorkingCommit();

    if (workingCommit) {
      // Compare against the loaded commit so just loading an older version doesn't count as "changes"
      const diff = await this.git.raw(["diff", "--name-only", workingCommit]);
      const diffFiles = this.getRelevantPaths(diff);

      const untracked = await this.git.raw([
        "ls-files",
        "--others",
        "--exclude-standard",
      ]);
      const untrackedFiles = this.getRelevantPaths(untracked);

      return diffFiles.length > 0 || untrackedFiles.length > 0;
    }

    const status = await this.git.raw(["status", "--porcelain"]);
    const statusLines = this.getRelevantStatusLines(status);
    return statusLines.length > 0;
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

    const workingCommit = await this.getWorkingCommit();

    if (workingCommit) {
      // Remove untracked files (but keep our marker file)
      await this.git.raw(["clean", "-fd", "-e", WORKING_COMMIT_MARKER]);
      // Restore to the loaded version
      await this.git.raw(["checkout", workingCommit, "--", "."]);
      return;
    }

    // Reset staged changes
    await this.git.reset(["--hard", "HEAD"]);
    // Clean untracked files
    await this.git.clean("fd");
  }

  async getHistory(
    limit: number = 50
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

  async getCommitCount(): Promise<number> {
    if (!this.git) return 0;
    try {
      const stdout = await this.git.raw(["rev-list", "--count", "HEAD"]);
      const count = Number.parseInt(stdout.trim(), 10);
      return Number.isFinite(count) ? count : 0;
    } catch {
      return 0;
    }
  }

  async loadVersion(commitHash: string): Promise<void> {
    if (!this.git || !this.workspaceDir) {
      throw new Error("Workspace not initialized");
    }

    // 1) Clean untracked files
    await this.git.raw(["clean", "-fd"]);

    // 2) Remove currently tracked files so we don't keep files that exist in HEAD but not in target commit
    try {
      const trackedFiles = await this.git.raw(["ls-files"]);
      const filesToDelete = trackedFiles
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);

      for (const file of filesToDelete) {
        const filePath = path.join(this.workspaceDir, file);
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
        }
      }
    } catch (err) {
      console.warn("[Git] Failed to clean tracked files before load:", err);
    }

    // 3) Restore files from the specific commit without changing HEAD
    await this.git.raw(["checkout", commitHash, "--", "."]);

    // Track the loaded commit in a marker file
    await this.setWorkingCommit(commitHash);
  }

  async getWorkingCommit(): Promise<string | null> {
    if (!this.workspaceDir) return null;
    const markerPath = path.join(this.workspaceDir, WORKING_COMMIT_MARKER);
    try {
      const exists = await fs.pathExists(markerPath);
      if (!exists) return null;
      const hash = (await fs.readFile(markerPath, "utf-8")).trim();
      if (!hash) return null;

      if (this.git) {
        try {
          const headHash = (await this.git.raw(["rev-parse", "HEAD"])).trim();
          if (headHash && headHash !== hash) {
            const status = await this.git.raw(["status", "--porcelain"]);
            const nonMarkerStatusLines = this.getRelevantStatusLines(status);
            // If HEAD advanced but there are no real workspace changes, the marker is stale.
            if (nonMarkerStatusLines.length === 0) {
              return null;
            }
          }
        } catch {
          // If we can't resolve HEAD/status, fall back to marker value.
        }
      }

      return hash;
    } catch {
      return null;
    }
  }

  private async setWorkingCommit(hash: string): Promise<void> {
    if (!this.workspaceDir) return;
    const markerPath = path.join(this.workspaceDir, WORKING_COMMIT_MARKER);
    await fs.writeFile(markerPath, hash, "utf-8");
  }

  private async clearWorkingCommit(): Promise<void> {
    if (!this.workspaceDir) return;
    const markerPath = path.join(this.workspaceDir, WORKING_COMMIT_MARKER);
    try {
      await fs.remove(markerPath);
    } catch {
      // ignore
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
      if (this.workspaceOwned) {
        try {
          await fs.remove(this.workspaceDir);
          console.log(`Cleaned up workspace: ${this.workspaceDir}`);
        } catch (error) {
          console.error(`Failed to cleanup workspace: ${error}`);
        }
      }
      this.workspaceDir = null;
      this.git = null;
      this.workspaceOwned = false;
    }
  }
}
