import { simpleGit } from "simple-git";
import type { SimpleGit } from "simple-git";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
  LEGACY_WORKING_COMMIT_MARKER,
  clearLegacyWorkingCommitMarker,
  clearLoadedSnapshotCommit,
  readLegacyWorkingCommitMarker,
  readLoadedSnapshotCommit,
  writeLoadedSnapshotCommit,
} from "./loadedSnapshotState.js";

const DEFAULT_INDEX_LOCK_STALE_MS = 30_000;

export class WorkspaceManager {
  private workspaceDir: string | null = null;
  private git: SimpleGit | null = null;
  private workspaceOwned = false;
  private configuredSafeDirectories = new Set<string>();
  private gitOperationQueue: Promise<unknown> = Promise.resolve();

  async open(directory: string): Promise<void> {
    this.workspaceDir = path.resolve(directory);
    this.workspaceOwned = false;
    await fs.ensureDir(this.workspaceDir);

    await this.cleanupGitIndexLock({ force: true, reason: "workspace open" });
    await this.ensureSafeDirectory(this.workspaceDir);
    this.git = simpleGit(this.workspaceDir);
    this.git.env({ ...process.env, GIT_TERMINAL_PROMPT: "0" });

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

    // Loading an older snapshot is session-local. Fresh opens should land on latest HEAD.
    const loadedSnapshotCommit = await this.getWorkingCommit();
    if (loadedSnapshotCommit) {
      console.warn(
        `[Git] Restoring latest snapshot on workspace open (previous pin ${loadedSnapshotCommit.slice(0, 7)}).`,
      );
      await this.loadLatest();
    }
  }

  private getGitIndexLockPath(): string | null {
    if (!this.workspaceDir) return null;
    return path.join(this.workspaceDir, ".git", "index.lock");
  }

  private getIndexLockStaleMs(): number {
    const raw = process.env.VIVD_GIT_INDEX_LOCK_STALE_MS;
    const parsed = Number.parseInt(raw || "", 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    return DEFAULT_INDEX_LOCK_STALE_MS;
  }

  private async cleanupGitIndexLock(options: {
    force: boolean;
    reason: string;
  }): Promise<boolean> {
    const lockPath = this.getGitIndexLockPath();
    if (!lockPath) return false;

    const exists = await fs.pathExists(lockPath);
    if (!exists) return false;

    if (!options.force) {
      const staleMs = this.getIndexLockStaleMs();
      try {
        const stat = await fs.stat(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < staleMs) return false;
      } catch {
        // If we can't stat it, fall back to removing it (best-effort).
      }
    }

    try {
      await fs.remove(lockPath);
      console.warn(
        `[Git] Removed ${options.force ? "existing" : "stale"} index.lock (${options.reason}).`,
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Git] Failed to remove index.lock (${options.reason}): ${message}`);
      return false;
    }
  }

  private isGitIndexLockError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("index.lock") && message.includes("File exists");
  }

  private async withGitLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      try {
        return await fn();
      } catch (err) {
        if (this.isGitIndexLockError(err)) {
          const removed = await this.cleanupGitIndexLock({
            force: false,
            reason: `${label} retry`,
          });
          if (removed) {
            return await fn();
          }
        }
        throw err;
      }
    };

    const next = this.gitOperationQueue.then(run, run);
    this.gitOperationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Runs an arbitrary async function serialized with all other git operations.
   * The callback must not call other WorkspaceManager methods that also acquire the git lock.
   */
  async runExclusive<T>(label: string, fn: (options: { cwd: string }) => Promise<T>): Promise<T> {
    return await this.withGitLock(label, async () => {
      if (!this.workspaceDir || !this.git) {
        throw new Error("Workspace not initialized");
      }
      return await fn({ cwd: this.workspaceDir });
    });
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
    this.git.env({ ...process.env, GIT_TERMINAL_PROMPT: "0" });
    await this.git.clone(authUrl, this.workspaceDir, [
      "--branch",
      branch,
      "--single-branch",
    ]);

    await this.cleanupGitIndexLock({ force: true, reason: "workspace clone" });
    // Initialize git in workspace directory
    this.git = simpleGit(this.workspaceDir);
    this.git.env({ ...process.env, GIT_TERMINAL_PROMPT: "0" });

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
    if (normalized === LEGACY_WORKING_COMMIT_MARKER) return true;
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
        const statusPath = this.normalizeGitPath(
          line.length > 3 && line[2] === " " ? line.slice(3) : line,
        );
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

  private parseChangedPathFromStatusLine(statusLine: string): string[] {
    const statusPath = this.normalizeGitPath(
      statusLine.length > 3 && statusLine[2] === " "
        ? statusLine.slice(3)
        : statusLine,
    );
    if (!statusPath) return [];

    if (statusPath.includes(" -> ")) {
      const [fromPath, toPath] = statusPath.split(" -> ").map((p) => p.trim());
      return [fromPath, toPath].filter(
        (filePath) => filePath && !this.isIgnoredWorkspacePath(filePath),
      );
    }

    return this.isIgnoredWorkspacePath(statusPath) ? [] : [statusPath];
  }

  async commit(message: string): Promise<string | null> {
    return await this.withGitLock("commit", async () => {
      if (!this.git || !this.workspaceDir) {
        throw new Error("Workspace not initialized");
      }

      // Self-heal a stale working-commit marker before staging/saving.
      await this.getWorkingCommitLocked();

      // Stage all changes
      await this.git.raw(["add", "-A"]);

      // Ensure our internal marker file is never committed and doesn't count as a "change"
      try {
        await this.git.raw(["reset", "HEAD", LEGACY_WORKING_COMMIT_MARKER]);
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
    });
  }

  async hasChanges(): Promise<boolean> {
    return await this.withGitLock("hasChanges", async () => {
      if (!this.git) {
        return false;
      }

      const workingCommit = await this.getWorkingCommitLocked();
      return await this.hasChangesLocked(workingCommit);
    });
  }

  async getChangedFiles(): Promise<string[]> {
    return await this.withGitLock("getChangedFiles", async () => {
      if (!this.git) {
        return [];
      }

      const workingCommit = await this.getWorkingCommitLocked();

      if (workingCommit) {
        const diff = await this.git.raw(["diff", "--name-only", workingCommit]);
        const diffFiles = this.getRelevantPaths(diff);

        const untracked = await this.git.raw([
          "ls-files",
          "--others",
          "--exclude-standard",
        ]);
        const untrackedFiles = this.getRelevantPaths(untracked);

        return [...new Set([...diffFiles, ...untrackedFiles])].sort();
      }

      const status = await this.git.raw(["status", "--porcelain"]);
      const statusLines = this.getRelevantStatusLines(status);
      const files = statusLines.flatMap((line) =>
        this.parseChangedPathFromStatusLine(line),
      );

      return [...new Set(files)].sort();
    });
  }

  private async hasChangesLocked(workingCommit: string | null): Promise<boolean> {
    if (!this.git) return false;

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
    return await this.withGitLock("getStatus", async () => {
      if (!this.git) {
        return { staged: [], modified: [], untracked: [] };
      }

      const status = await this.git.status();
      return {
        staged: status.staged,
        modified: status.modified,
        untracked: status.not_added,
      };
    });
  }

  async discardChanges(): Promise<void> {
    return await this.withGitLock("discardChanges", async () => {
      if (!this.git || !this.workspaceDir) {
        throw new Error("Workspace not initialized");
      }

      const workingCommit = await this.getWorkingCommitLocked();

      if (workingCommit) {
        // Remove untracked files before restoring the loaded snapshot.
        await this.git.raw(["clean", "-fd"]);
        // Restore to the loaded version
        await this.git.raw(["checkout", workingCommit, "--", "."]);
        return;
      }

      // Reset staged changes
      await this.git.reset(["--hard", "HEAD"]);
      // Clean untracked files
      await this.git.clean("fd");
    });
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
    return await this.withGitLock("getHistory", async () => {
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
    });
  }

  async getCommitCount(): Promise<number> {
    return await this.withGitLock("getCommitCount", async () => {
      if (!this.git) return 0;
      try {
        const stdout = await this.git.raw(["rev-list", "--count", "HEAD"]);
        const count = Number.parseInt(stdout.trim(), 10);
        return Number.isFinite(count) ? count : 0;
      } catch {
        return 0;
      }
    });
  }

  async loadVersion(commitHash: string): Promise<void> {
    return await this.withGitLock("loadVersion", async () => {
      if (!this.git || !this.workspaceDir) {
        throw new Error("Workspace not initialized");
      }

      const headHash = await this.getHeadHashLocked();
      if (headHash && headHash === commitHash.trim()) {
        await this.loadLatestLocked();
        return;
      }

      await this.restoreCommitFilesLocked(commitHash);
      await this.setWorkingCommit(commitHash);
    });
  }

  async loadLatest(): Promise<void> {
    return await this.withGitLock("loadLatest", async () => {
      await this.loadLatestLocked();
    });
  }

  async getWorkingCommit(): Promise<string | null> {
    return await this.withGitLock("getWorkingCommit", async () => {
      return await this.getWorkingCommitLocked();
    });
  }

  private async getWorkingCommitLocked(): Promise<string | null> {
    if (!this.workspaceDir) return null;
    const storedHash = await readLoadedSnapshotCommit(this.workspaceDir);
    const legacyHash = storedHash ? null : await readLegacyWorkingCommitMarker(this.workspaceDir);
    const hash = storedHash || legacyHash;
    if (!hash) return null;

    if (this.git) {
      try {
        const headHash = (await this.git.raw(["rev-parse", "HEAD"])).trim();
        if (headHash && headHash === hash) {
          await this.clearWorkingCommit();
          return null;
        }
        if (headHash && headHash !== hash) {
          const status = await this.git.raw(["status", "--porcelain"]);
          const nonMarkerStatusLines = this.getRelevantStatusLines(status);
          // If the workspace matches HEAD again, the loaded-snapshot state is stale.
          if (nonMarkerStatusLines.length === 0) {
            await this.clearWorkingCommit();
            return null;
          }
        }
      } catch {
        // If we can't resolve HEAD/status, fall back to the stored value.
      }
    }

    if (legacyHash && !storedHash) {
      await this.setWorkingCommit(hash);
    }

    return hash;
  }

  private async setWorkingCommit(hash: string): Promise<void> {
    if (!this.workspaceDir) return;
    await writeLoadedSnapshotCommit(this.workspaceDir, hash);
    await clearLegacyWorkingCommitMarker(this.workspaceDir);
  }

  private async clearWorkingCommit(): Promise<void> {
    if (!this.workspaceDir) return;
    await clearLoadedSnapshotCommit(this.workspaceDir);
    await clearLegacyWorkingCommitMarker(this.workspaceDir);
  }

  private async restoreCommitFilesLocked(commitHash: string): Promise<void> {
    if (!this.git || !this.workspaceDir) {
      throw new Error("Workspace not initialized");
    }

    // 1) Clean untracked files.
    await this.git.raw(["clean", "-fd"]);

    // 2) Remove tracked files so deleted files from the target commit disappear too.
    try {
      const trackedFiles = await this.git.raw(["ls-files"]);
      const filesToDelete = trackedFiles
        .split("\n")
        .map((filePath) => filePath.trim())
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

    // 3) Restore files from the target commit without moving HEAD.
    await this.git.raw(["checkout", commitHash, "--", "."]);
  }

  private async loadLatestLocked(): Promise<void> {
    if (!this.git) {
      throw new Error("Workspace not initialized");
    }

    const headHash = await this.getHeadHashLocked();
    if (!headHash) {
      await this.clearWorkingCommit();
      return;
    }

    await this.restoreCommitFilesLocked(headHash);
    await this.clearWorkingCommit();
  }

  async getHeadCommit(): Promise<{ hash: string; message: string } | null> {
    return await this.withGitLock("getHeadCommit", async () => {
      if (!this.git) return null;
      try {
        const log = await this.git.log({ maxCount: 1 });
        const latest = log.latest;
        if (!latest) return null;
        return { hash: latest.hash, message: latest.message };
      } catch {
        return null;
      }
    });
  }

  private withHttpAuthArgs(authHeader: string | undefined, args: string[]): string[] {
    if (!authHeader) return args;
    return ["-c", `http.extraHeader=${authHeader}`, ...args];
  }

  private async getHeadHashLocked(): Promise<string | null> {
    if (!this.git) return null;
    try {
      const stdout = await this.git.raw(["rev-parse", "HEAD"]);
      const hash = stdout.trim();
      return hash ? hash : null;
    } catch {
      return null;
    }
  }

  private async getBranchLocked(): Promise<{ branch: string | null; detached: boolean }> {
    if (!this.git) return { branch: null, detached: true };
    try {
      const stdout = await this.git.raw(["rev-parse", "--abbrev-ref", "HEAD"]);
      const value = stdout.trim();
      if (!value || value === "HEAD") return { branch: null, detached: true };
      return { branch: value, detached: false };
    } catch {
      return { branch: null, detached: true };
    }
  }

  private async getRemoteUrlLocked(remoteName: string): Promise<string | null> {
    if (!this.git) return null;
    const name = remoteName.trim();
    if (!name) return null;
    try {
      const stdout = await this.git.raw(["remote", "get-url", name]);
      const url = stdout.trim();
      return url ? url : null;
    } catch {
      return null;
    }
  }

  private async ensureRemoteUrlLocked(remoteName: string, remoteUrl: string): Promise<void> {
    if (!this.git) throw new Error("Workspace not initialized");
    const name = remoteName.trim();
    const url = remoteUrl.trim();
    if (!name) throw new Error("Remote name missing");
    if (!url) throw new Error("Remote URL missing");

    try {
      const stdout = await this.git.raw(["remote", "get-url", name]);
      const current = stdout.trim();
      if (current === url) return;
      await this.git.raw(["remote", "set-url", name, url]);
    } catch {
      await this.git.raw(["remote", "add", name, url]);
    }
  }

  private async fetchRemoteLocked(options: {
    remoteName: string;
    authHeader?: string;
  }): Promise<void> {
    if (!this.git) throw new Error("Workspace not initialized");
    const name = options.remoteName.trim();
    if (!name) throw new Error("Remote name missing");
    await this.git.raw(this.withHttpAuthArgs(options.authHeader, ["fetch", name, "--prune"]));
  }

  private async remoteRefExistsLocked(remoteRef: string): Promise<boolean> {
    if (!this.git) return false;
    try {
      const stdout = await this.git.raw(["rev-parse", "--verify", remoteRef]);
      return Boolean(stdout.trim());
    } catch {
      return false;
    }
  }

  private async getAheadBehindLocked(remoteRef: string): Promise<{ ahead: number; behind: number }> {
    if (!this.git) return { ahead: 0, behind: 0 };
    const stdout = await this.git.raw([
      "rev-list",
      "--left-right",
      "--count",
      `HEAD...${remoteRef}`,
    ]);
    const parts = stdout.trim().split(/\s+/).filter(Boolean);
    const ahead = Number.parseInt(parts[0] ?? "0", 10);
    const behind = Number.parseInt(parts[1] ?? "0", 10);
    return {
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  }

  async getRemoteSyncStatus(options: {
    remoteName: string;
    remoteUrl?: string;
    remoteBranch: string;
    authHeader?: string;
    fetch?: boolean;
  }): Promise<{
    headHash: string | null;
    branch: string | null;
    detached: boolean;
    hasUncommittedChanges: boolean;
    workingCommitHash: string | null;
    workingCommitPinned: boolean;
    remoteUrl: string | null;
    fetchError: string | null;
    remoteBranchExists: boolean | null;
    ahead: number | null;
    behind: number | null;
    diverged: boolean | null;
  }> {
    return await this.withGitLock("getRemoteSyncStatus", async () => {
      if (!this.git || !this.workspaceDir) {
        throw new Error("Workspace not initialized");
      }

      const headHash = await this.getHeadHashLocked();
      const workingCommitHash = await this.getWorkingCommitLocked();
      const hasUncommittedChanges = await this.hasChangesLocked(workingCommitHash);
      const workingCommitPinned = Boolean(
        headHash && workingCommitHash && workingCommitHash !== headHash,
      );

      const { branch, detached } = await this.getBranchLocked();

      const remoteName = options.remoteName.trim();
      const remoteBranch = options.remoteBranch.trim();
      const shouldFetch = options.fetch ?? true;

      let remoteUrl = await this.getRemoteUrlLocked(remoteName);
      let fetchError: string | null = null;

      if (options.remoteUrl) {
        try {
          await this.ensureRemoteUrlLocked(remoteName, options.remoteUrl);
          remoteUrl = options.remoteUrl;
        } catch (err) {
          fetchError = err instanceof Error ? err.message : String(err);
        }
      }

      if (!fetchError && shouldFetch) {
        try {
          await this.fetchRemoteLocked({
            remoteName,
            authHeader: options.authHeader,
          });
        } catch (err) {
          fetchError = err instanceof Error ? err.message : String(err);
        }
      }

      const remoteRef = remoteName && remoteBranch ? `${remoteName}/${remoteBranch}` : "";

      if (fetchError || !remoteRef) {
        return {
          headHash,
          branch,
          detached,
          hasUncommittedChanges,
          workingCommitHash,
          workingCommitPinned,
          remoteUrl,
          fetchError,
          remoteBranchExists: null,
          ahead: null,
          behind: null,
          diverged: null,
        };
      }

      const remoteBranchExists = await this.remoteRefExistsLocked(remoteRef);
      if (!remoteBranchExists) {
        return {
          headHash,
          branch,
          detached,
          hasUncommittedChanges,
          workingCommitHash,
          workingCommitPinned,
          remoteUrl,
          fetchError: null,
          remoteBranchExists: false,
          ahead: null,
          behind: null,
          diverged: null,
        };
      }

      let ahead: number | null = null;
      let behind: number | null = null;
      let diverged: boolean | null = null;
      try {
        const counts = await this.getAheadBehindLocked(remoteRef);
        ahead = counts.ahead;
        behind = counts.behind;
        diverged = counts.ahead > 0 && counts.behind > 0;
      } catch {
        ahead = null;
        behind = null;
        diverged = null;
      }

      return {
        headHash,
        branch,
        detached,
        hasUncommittedChanges,
        workingCommitHash,
        workingCommitPinned,
        remoteUrl,
        fetchError: null,
        remoteBranchExists: true,
        ahead,
        behind,
        diverged,
      };
    });
  }

  async pullFastForwardFromRemote(options: {
    remoteName: string;
    remoteUrl: string;
    remoteBranch: string;
    authHeader?: string;
  }): Promise<{ headHash: string; previousHeadHash: string }> {
    return await this.withGitLock("pullFastForwardFromRemote", async () => {
      if (!this.git || !this.workspaceDir) {
        throw new Error("Workspace not initialized");
      }

      const remoteName = options.remoteName.trim();
      const remoteBranch = options.remoteBranch.trim();
      if (!remoteName) throw new Error("Remote name missing");
      if (!remoteBranch) throw new Error("Remote branch missing");

      const previousHeadHash = await this.getHeadHashLocked();
      if (!previousHeadHash) throw new Error("Unable to resolve HEAD");

      const workingCommitHash = await this.getWorkingCommitLocked();
      const workingCommitPinned = Boolean(
        workingCommitHash && workingCommitHash !== previousHeadHash,
      );
      if (workingCommitPinned) {
        throw new Error("You're viewing an older snapshot. Restore it before pulling.");
      }

      const hasUncommittedChanges = await this.hasChangesLocked(workingCommitHash);
      if (hasUncommittedChanges) {
        throw new Error("You have uncommitted changes. Save or discard them before pulling.");
      }

      const { branch, detached } = await this.getBranchLocked();
      if (detached) {
        throw new Error("You're in a detached HEAD state. Restore your main branch before pulling.");
      }
      if (branch !== remoteBranch) {
        throw new Error(`You're on '${branch}'. Switch to '${remoteBranch}' before pulling.`);
      }

      await this.ensureRemoteUrlLocked(remoteName, options.remoteUrl);
      await this.fetchRemoteLocked({ remoteName, authHeader: options.authHeader });

      const remoteRef = `${remoteName}/${remoteBranch}`;
      const remoteExists = await this.remoteRefExistsLocked(remoteRef);
      if (!remoteExists) {
        throw new Error(`Remote branch '${remoteRef}' not found.`);
      }

      const counts = await this.getAheadBehindLocked(remoteRef);
      if (counts.ahead > 0 && counts.behind > 0) {
        throw new Error("Your local branch has diverged from GitHub. Use force sync instead.");
      }
      if (counts.ahead > 0 && counts.behind === 0) {
        throw new Error("Your local branch is ahead of GitHub. Push or force sync instead.");
      }
      if (counts.behind === 0) {
        throw new Error("Already up to date.");
      }

      await this.git.raw(["merge", "--ff-only", remoteRef]);

      const headHash = await this.getHeadHashLocked();
      if (!headHash) throw new Error("Unable to resolve HEAD after pull");

      return { headHash, previousHeadHash };
    });
  }

  private getForceSyncBackupTagName(): string {
    const iso = new Date().toISOString().replace(/[:.]/g, "-");
    return `vivd-backup-${iso}`;
  }

  async forceSyncFromRemote(options: {
    remoteName: string;
    remoteUrl: string;
    remoteBranch: string;
    authHeader?: string;
  }): Promise<{ headHash: string; backupTag: string; backupCommitHash: string }> {
    return await this.withGitLock("forceSyncFromRemote", async () => {
      if (!this.git || !this.workspaceDir) {
        throw new Error("Workspace not initialized");
      }

      const remoteName = options.remoteName.trim();
      const remoteBranch = options.remoteBranch.trim();
      if (!remoteName) throw new Error("Remote name missing");
      if (!remoteBranch) throw new Error("Remote branch missing");

      const preHead = await this.getHeadHashLocked();
      if (!preHead) throw new Error("Unable to resolve HEAD");

      const workingCommitHash = await this.getWorkingCommitLocked();
      const hasUncommittedChanges = await this.hasChangesLocked(workingCommitHash);

      let backupCommitHash = preHead;
      if (hasUncommittedChanges) {
        await this.git.raw(["add", "-A"]);
        try {
          await this.git.raw(["reset", "HEAD", LEGACY_WORKING_COMMIT_MARKER]);
        } catch {
          // ignore
        }

        const staged = await this.git.raw(["diff", "--cached", "--name-only"]);
        if (staged.trim()) {
          await this.git.commit(
            `Backup before force sync from GitHub (${new Date().toISOString()})`,
          );
          await this.clearWorkingCommit();
          const afterCommit = await this.getHeadHashLocked();
          if (afterCommit) {
            backupCommitHash = afterCommit;
          }
        }
      }

      let backupTag = this.getForceSyncBackupTagName();
      try {
        await this.git.raw(["tag", backupTag]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("already exists")) {
          const suffix = Math.random().toString(16).slice(2, 8);
          backupTag = `${backupTag}-${suffix}`;
          await this.git.raw(["tag", backupTag]);
        } else {
          throw err;
        }
      }

      await this.ensureRemoteUrlLocked(remoteName, options.remoteUrl);
      await this.fetchRemoteLocked({ remoteName, authHeader: options.authHeader });

      const remoteRef = `${remoteName}/${remoteBranch}`;
      const remoteExists = await this.remoteRefExistsLocked(remoteRef);
      if (!remoteExists) {
        throw new Error(`Remote branch '${remoteRef}' not found.`);
      }

      await this.git.raw(["reset", "--hard", remoteRef]);
      await this.git.raw(["clean", "-fd"]);
      // Ensure we're on the expected branch even if HEAD was detached before.
      await this.git.raw(["checkout", "-B", remoteBranch, remoteRef]);

      const headHash = await this.getHeadHashLocked();
      if (!headHash) throw new Error("Unable to resolve HEAD after force sync");

      return { headHash, backupTag, backupCommitHash };
    });
  }

  async getTags(): Promise<string[]> {
    return await this.withGitLock("getTags", async () => {
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
    });
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
