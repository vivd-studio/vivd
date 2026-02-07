import { execa } from "execa";
import * as fs from "fs";
import * as path from "path";
import { getActiveTenantId } from "../generator/versionUtils";
import { getGitHubSyncSettings, gitHubApiService } from "./GitHubApiService";

// Marker file name for tracking working commit
const WORKING_COMMIT_MARKER = ".vivd-working-commit";

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  author: string;
  parents: string[];
}

export interface SaveResult {
  success: boolean;
  hash: string;
  noChanges?: boolean;
}

export type GitHubSyncResult =
  | { attempted: false; success: true }
  | { attempted: true; success: true; repo: string; remoteUrl: string }
  | {
      attempted: true;
      success: false;
      error: string;
      repo?: string;
      remoteUrl?: string;
    };

/**
 * Service for Git operations on project version directories.
 * Each project version (projects/{slug}/v{N}/) is a Git repository.
 */
export class GitService {
  /**
   * Mark a directory as safe for git operations (fixes Docker ownership issues)
   */
  private async ensureSafeDirectory(cwd: string): Promise<void> {
    try {
      await execa("git", [
        "config",
        "--global",
        "--add",
        "safe.directory",
        cwd,
      ]);
    } catch {
      // Ignore errors - safe.directory might already be set
    }
  }

  /**
   * Check if a directory is a git repository
   */
  async isGitRepository(cwd: string): Promise<boolean> {
    if (!fs.existsSync(cwd)) return false;
    try {
      await this.ensureSafeDirectory(cwd);
      await execa("git", ["rev-parse", "--git-dir"], { cwd });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize a git repository if it doesn't exist
   */
  async ensureGitRepository(cwd: string): Promise<void> {
    await this.ensureSafeDirectory(cwd);

    if (await this.isGitRepository(cwd)) return;

    await execa("git", ["init"], { cwd });
    await execa("git", ["branch", "-M", "main"], { cwd });

    // Configure git user for commits (required in containers)
    await execa("git", ["config", "user.email", "vivd@local"], { cwd });
    await execa("git", ["config", "user.name", "Vivd"], { cwd });
  }

  /**
   * Commit all changes with a message.
   * Returns the commit hash of the new commit.
   */
  async save(cwd: string, message: string): Promise<SaveResult> {
    await this.ensureGitRepository(cwd);

    // Stage all changes
    await execa("git", ["add", "-A"], { cwd });

    // Unstage the working commit marker file so it doesn't get committed
    // and doesn't count as a "change" if it's the only thing that changed
    try {
      await execa("git", ["reset", "HEAD", WORKING_COMMIT_MARKER], { cwd });
    } catch {
      // Ignore if file wasn't staged or doesn't exist
    }

    // Check if there are staged changes
    const { stdout: status } = await execa(
      "git",
      ["diff", "--cached", "--name-only"],
      { cwd }
    );

    if (!status.trim()) {
      // No changes to commit
      const hash = await this.getCurrentCommit(cwd);
      return { success: true, hash: hash || "", noChanges: true };
    }

    // Commit the changes
    await execa("git", ["commit", "-m", message], { cwd });

    // Get the new commit hash
    const hash = await this.getCurrentCommit(cwd);

    // Clear working commit marker since we're now at the new HEAD
    this.clearWorkingCommit(cwd);

    return { success: true, hash: hash || "", noChanges: false };
  }

  /**
   * Get commit history as a list of commits.
   */
  async getHistory(cwd: string): Promise<CommitInfo[]> {
    if (!(await this.isGitRepository(cwd))) {
      return [];
    }

    try {
      // Use a custom format that's easy to parse
      // Format: hash|shortHash|author|date|message|parents
      const { stdout } = await execa(
        "git",
        [
          "log",
          "--format=%H|%h|%an|%aI|%s|%P",
          "-n",
          "50", // Limit to last 50 commits
        ],
        { cwd }
      );

      if (!stdout.trim()) {
        return [];
      }

      return stdout
        .trim()
        .split("\n")
        .map((line) => {
          const parts = line.split("|");
          // line format: hash|shortHash|author|date|message|parents
          // We know the first 4 and the last 1 are fixed fields.
          // Everything in between is the message.

          if (parts.length < 6) {
            // Fallback for unexpected format (shouldn't happen with our format string)
            // Try to make best guess
            const [hash, shortHash, author, date, ...rest] = parts;
            return {
              hash,
              shortHash,
              author,
              date,
              message: rest.join("|"),
              parents: [],
            };
          }

          const hash = parts[0];
          const shortHash = parts[1];
          const author = parts[2];
          const date = parts[3];
          const parentsStr = parts[parts.length - 1];
          // Message is everything from index 4 to length-2 (inclusive)
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
    } catch (error) {
      // No commits yet or other error
      return [];
    }
  }

  /**
   * Restore files from a specific commit without changing HEAD.
   * This effectively "loads" a previous version while keeping git history.
   */
  async loadVersion(cwd: string, commitHash: string): Promise<void> {
    if (!(await this.isGitRepository(cwd))) {
      throw new Error("Not a git repository");
    }

    // 1. Clean untracked files
    await execa("git", ["clean", "-fd"], { cwd });

    // 2. Remove all currently tracked files (to ensure we don't keep files that are in HEAD but not in target commit)
    // We use git ls-files to find what to delete, so we don't delete ignored files
    try {
      const { stdout: trackedFiles } = await execa("git", ["ls-files"], {
        cwd,
      });
      const filesToDelete = trackedFiles.split("\n").filter((f) => f.trim());

      for (const file of filesToDelete) {
        const filePath = path.join(cwd, file);
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { force: true });
        }
      }

      // Also invoke clean again to be sure about directories?
      // recursive rmSync above might fail if it's a file inside a dir?
      // fs.rmSync deletes file. If directory becomes empty, it stays?
      // git clean -fd might handle empty dirs?
      // Let's iterate responsibly or just rely on checkout to recreate structure.
    } catch (e) {
      console.warn("Failed to clean workspace before load:", e);
    }

    // 3. Checkout files from the specific commit
    // Using `checkout <hash> -- .` restores files without moving HEAD
    await execa("git", ["checkout", commitHash, "--", "."], { cwd });

    // Track the loaded commit in a marker file
    this.setWorkingCommit(cwd, commitHash);
  }

  /**
   * Get the current HEAD commit hash.
   */
  async getCurrentCommit(cwd: string): Promise<string | null> {
    if (!(await this.isGitRepository(cwd))) {
      return null;
    }

    try {
      const { stdout } = await execa("git", ["rev-parse", "HEAD"], { cwd });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Check if there are uncommitted changes (staged or unstaged).
   * If a working commit marker exists (older version loaded), compare against that commit.
   * Otherwise, compare against HEAD.
   * Note: Excludes our internal marker file from detection.
   */
  async hasUncommittedChanges(cwd: string): Promise<boolean> {
    if (!(await this.isGitRepository(cwd))) {
      // If not a git repo, consider all files as "uncommitted"
      return fs.existsSync(cwd) && fs.readdirSync(cwd).length > 0;
    }

    try {
      // Check if we loaded an older version
      const workingCommit = this.getWorkingCommit(cwd);

      if (workingCommit) {
        // Compare working directory against the loaded commit
        // This way, just loading an older version doesn't count as "changes"
        const { stdout } = await execa(
          "git",
          ["diff", "--name-only", workingCommit],
          { cwd }
        );
        // Filter out our marker file from the diff (it exists now but not in the loaded commit)
        const diffFiles = stdout
          .trim()
          .split("\n")
          .filter((f) => f && f !== WORKING_COMMIT_MARKER);

        // Also check for untracked files, excluding our marker file
        const { stdout: untracked } = await execa(
          "git",
          ["ls-files", "--others", "--exclude-standard"],
          { cwd }
        );
        // Filter out our marker file
        const untrackedFiles = untracked
          .trim()
          .split("\n")
          .filter((f) => f && f !== WORKING_COMMIT_MARKER);

        return diffFiles.length > 0 || untrackedFiles.length > 0;
      }

      // No working commit marker = we're on HEAD, use normal status check
      const { stdout } = await execa("git", ["status", "--porcelain"], { cwd });
      // Filter out our marker file from status
      const statusLines = stdout
        .trim()
        .split("\n")
        .filter((line) => line && !line.endsWith(WORKING_COMMIT_MARKER));

      return statusLines.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get short hash for display purposes.
   */
  async getShortHash(cwd: string, hash: string): Promise<string> {
    try {
      const { stdout } = await execa("git", ["rev-parse", "--short", hash], {
        cwd,
      });
      return stdout.trim();
    } catch {
      return hash.substring(0, 7);
    }
  }

  /**
   * Get the currently loaded commit (the one whose files are in working directory).
   * This may differ from HEAD if loadVersion was used to restore an older version.
   */
  getWorkingCommit(cwd: string): string | null {
    const markerPath = path.join(cwd, WORKING_COMMIT_MARKER);
    if (fs.existsSync(markerPath)) {
      return fs.readFileSync(markerPath, "utf-8").trim();
    }
    // Fall back to HEAD if no marker exists (not loaded from older version)
    return null;
  }

  /**
   * Set the working commit marker.
   */
  private setWorkingCommit(cwd: string, hash: string): void {
    const markerPath = path.join(cwd, WORKING_COMMIT_MARKER);
    fs.writeFileSync(markerPath, hash, "utf-8");
  }

  /**
   * Clear the working commit marker (called after save).
   */
  private clearWorkingCommit(cwd: string): void {
    const markerPath = path.join(cwd, WORKING_COMMIT_MARKER);
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
    }
  }

  /**
   * Untrack files/directories that are in .gitignore but still tracked.
   * Runs `git rm --cached -r` on the specified paths.
   * Returns the list of paths that were untracked.
   */
  async untrackIgnoredPaths(
    cwd: string,
    paths: string[]
  ): Promise<{ untracked: string[]; alreadyUntracked: string[] }> {
    await this.ensureSafeDirectory(cwd);

    if (!(await this.isGitRepository(cwd))) {
      throw new Error("Not a git repository");
    }

    const untracked: string[] = [];
    const alreadyUntracked: string[] = [];

    for (const p of paths) {
      const fullPath = path.join(cwd, p);

      // Check if path exists
      if (!fs.existsSync(fullPath)) {
        alreadyUntracked.push(p);
        continue;
      }

      // Check if path is tracked by git
      try {
        await execa("git", ["ls-files", "--error-unmatch", p], { cwd });
        // If no error, the path is tracked - untrack it
        const isDir = fs.statSync(fullPath).isDirectory();
        const args = isDir
          ? ["rm", "--cached", "-r", p]
          : ["rm", "--cached", p];
        await execa("git", args, { cwd });
        untracked.push(p);
      } catch {
        // Path is not tracked
        alreadyUntracked.push(p);
      }
    }

    return { untracked, alreadyUntracked };
  }

  /**
   * Discard all uncommitted changes (both staged and unstaged).
   * If viewing an older version (working commit marker exists), restore to that version.
   * Otherwise, reset to HEAD.
   */
  async discardChanges(cwd: string): Promise<void> {
    await this.ensureSafeDirectory(cwd);

    if (!(await this.isGitRepository(cwd))) {
      throw new Error("Not a git repository");
    }

    // Check if we're viewing an older version
    const workingCommit = this.getWorkingCommit(cwd);

    // Remove untracked files and directories first
    await execa("git", ["clean", "-fd"], { cwd });

    if (workingCommit) {
      // Restore to the loaded version
      await execa("git", ["checkout", workingCommit, "--", "."], { cwd });
    } else {
      // Reset to HEAD
      await execa("git", ["reset", "HEAD"], { cwd });
      await execa("git", ["checkout", "--", "."], { cwd });
    }
  }

  private getGitHttpAuthHeaderValue(token: string): string {
    // GitHub Git-over-HTTPS expects Basic auth (username can be anything).
    // Using http.extraHeader keeps the token out of the remote URL.
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    return `AUTHORIZATION: basic ${basic}`;
  }

  private buildGitHubRepoName(args: {
    tenantId: string;
    slug: string;
    version: number;
  }): string {
    const settings = getGitHubSyncSettings();
    const base = `${args.tenantId}-${args.slug}-v${args.version}`;
    const withPrefix = `${settings.repoPrefix}${base}`;
    return withPrefix
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
      .slice(0, 100);
  }

  private buildGitHubRemoteUrl(
    org: string,
    repo: string,
    gitHost: string,
  ): string {
    return `https://${gitHost}/${org}/${repo}.git`;
  }

  private async ensureRemoteUrl(
    cwd: string,
    remoteName: string,
    remoteUrl: string,
  ): Promise<void> {
    await this.ensureSafeDirectory(cwd);

    try {
      const { stdout } = await execa("git", ["remote", "get-url", remoteName], {
        cwd,
      });
      if (stdout.trim() === remoteUrl) return;
      await execa("git", ["remote", "set-url", remoteName, remoteUrl], { cwd });
    } catch {
      await execa("git", ["remote", "add", remoteName, remoteUrl], { cwd });
    }
  }

  private async gitWithHttpAuth(
    cwd: string,
    token: string,
    args: string[],
  ): Promise<void> {
    const extraHeader = this.getGitHttpAuthHeaderValue(token);
    await execa("git", ["-c", `http.extraHeader=${extraHeader}`, ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
  }

  private sanitizeGitAuthFromMessage(message: string): string {
    return message.replace(
      /http\.extraHeader=AUTHORIZATION:\s*basic\s+[A-Za-z0-9+/=]+/gi,
      "http.extraHeader=AUTHORIZATION: basic <redacted>",
    );
  }

  async syncPushToGitHub(params: {
    cwd: string;
    slug: string;
    version: number;
    tenantId?: string;
  }): Promise<GitHubSyncResult> {
    const settings = getGitHubSyncSettings();
    if (!settings.enabled) return { attempted: false, success: true };

    if (!settings.org || !settings.token) {
      const error = "GITHUB_ORG/GITHUB_TOKEN missing";
      if (settings.strict) throw new Error(error);
      return { attempted: true, success: false, error };
    }

    const tenantId = params.tenantId || getActiveTenantId();
    const repoName = this.buildGitHubRepoName({
      tenantId,
      slug: params.slug,
      version: params.version,
    });
    const remoteUrl = this.buildGitHubRemoteUrl(
      settings.org,
      repoName,
      settings.gitHost,
    );

    try {
      await this.ensureGitRepository(params.cwd);
      await gitHubApiService.ensureOrgRepoExists(settings.org, repoName, settings);
      await this.ensureRemoteUrl(params.cwd, settings.remoteName, remoteUrl);

      // Sync current HEAD to main. Keep tags (publishes are tags in some flows).
      await this.gitWithHttpAuth(params.cwd, settings.token, [
        "push",
        "--tags",
        "-u",
        settings.remoteName,
        "HEAD:main",
      ]);

      return {
        attempted: true,
        success: true,
        repo: `${settings.org}/${repoName}`,
        remoteUrl,
      };
    } catch (error) {
      const msgRaw = error instanceof Error ? error.message : String(error);
      const msg = this.sanitizeGitAuthFromMessage(msgRaw);
      if (settings.strict) throw error;
      console.warn("GitHub sync push failed:", msg);
      return {
        attempted: true,
        success: false,
        error: msg,
        repo: `${settings.org}/${repoName}`,
        remoteUrl,
      };
    }
  }

  async syncPullFromGitHub(params: {
    cwd: string;
    slug: string;
    version: number;
    tenantId?: string;
  }): Promise<GitHubSyncResult & { skippedReason?: string }> {
    const settings = getGitHubSyncSettings();
    if (!settings.enabled) return { attempted: false, success: true };

    if (!settings.org || !settings.token) {
      const error = "GITHUB_ORG/GITHUB_TOKEN missing";
      if (settings.strict) throw new Error(error);
      return { attempted: true, success: false, error };
    }

    const tenantId = params.tenantId || getActiveTenantId();
    const repoName = this.buildGitHubRepoName({
      tenantId,
      slug: params.slug,
      version: params.version,
    });
    const remoteUrl = this.buildGitHubRemoteUrl(
      settings.org,
      repoName,
      settings.gitHost,
    );

    try {
      await this.ensureGitRepository(params.cwd);

      const workingCommit = this.getWorkingCommit(params.cwd);
      if (workingCommit) {
        return {
          attempted: true,
          success: true,
          repo: `${settings.org}/${repoName}`,
          remoteUrl,
          skippedReason: "Working directory pinned to older commit",
        };
      }

      const hasChanges = await this.hasUncommittedChanges(params.cwd);
      if (hasChanges) {
        return {
          attempted: true,
          success: true,
          repo: `${settings.org}/${repoName}`,
          remoteUrl,
          skippedReason: "Uncommitted local changes",
        };
      }

      const { stdout: branch } = await execa(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: params.cwd },
      );
      if (branch.trim() === "HEAD") {
        return {
          attempted: true,
          success: true,
          repo: `${settings.org}/${repoName}`,
          remoteUrl,
          skippedReason: "Detached HEAD",
        };
      }

      const exists = await gitHubApiService.repoExists(
        settings.org,
        repoName,
        settings,
      );
      if (!exists) {
        return {
          attempted: true,
          success: true,
          repo: `${settings.org}/${repoName}`,
          remoteUrl,
          skippedReason: "Remote repo does not exist yet",
        };
      }

      await this.ensureRemoteUrl(params.cwd, settings.remoteName, remoteUrl);

      // Avoid auto-merges/rebases; only fast-forward.
      try {
        await this.gitWithHttpAuth(params.cwd, settings.token, [
          "fetch",
          settings.remoteName,
          "main",
        ]);
      } catch (fetchError) {
        const fetchMsgRaw =
          fetchError instanceof Error ? fetchError.message : String(fetchError);
        const fetchMsg = this.sanitizeGitAuthFromMessage(fetchMsgRaw);
        if (
          fetchMsg.toLowerCase().includes("couldn't find remote ref") ||
          fetchMsg.toLowerCase().includes("remote branch main not found")
        ) {
          return {
            attempted: true,
            success: true,
            repo: `${settings.org}/${repoName}`,
            remoteUrl,
            skippedReason: "Remote has no main branch yet",
          };
        }
        throw new Error(fetchMsg);
      }

      const { stdout: counts } = await execa(
        "git",
        [
          "rev-list",
          "--left-right",
          "--count",
          `HEAD...${settings.remoteName}/main`,
        ],
        { cwd: params.cwd },
      );
      const [aheadRaw, behindRaw] = counts.trim().split(/\s+/);
      const ahead = Number(aheadRaw || "0");
      const behind = Number(behindRaw || "0");

      if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
        return {
          attempted: true,
          success: true,
          repo: `${settings.org}/${repoName}`,
          remoteUrl,
          skippedReason: "Failed to compare local and remote history",
        };
      }

      if (behind === 0) {
        return {
          attempted: true,
          success: true,
          repo: `${settings.org}/${repoName}`,
          remoteUrl,
          skippedReason: ahead > 0 ? "Local ahead of remote" : "Already up to date",
        };
      }

      if (ahead > 0 && behind > 0) {
        return {
          attempted: true,
          success: true,
          repo: `${settings.org}/${repoName}`,
          remoteUrl,
          skippedReason: "Histories diverged",
        };
      }

      // behind > 0 and ahead === 0 => fast-forward.
      await execa("git", ["merge", "--ff-only", `${settings.remoteName}/main`], {
        cwd: params.cwd,
      });

      return {
        attempted: true,
        success: true,
        repo: `${settings.org}/${repoName}`,
        remoteUrl,
      };
    } catch (error) {
      const msgRaw = error instanceof Error ? error.message : String(error);
      const msg = this.sanitizeGitAuthFromMessage(msgRaw);
      if (settings.strict) throw error;
      console.warn("GitHub sync pull failed:", msg);
      return {
        attempted: true,
        success: false,
        error: msg,
        repo: `${settings.org}/${repoName}`,
        remoteUrl,
      };
    }
  }

}

// Export a singleton instance
export const gitService = new GitService();
