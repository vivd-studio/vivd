import { execa } from "execa";
import * as fs from "fs";
import * as path from "path";

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
}

// Export a singleton instance
export const gitService = new GitService();
