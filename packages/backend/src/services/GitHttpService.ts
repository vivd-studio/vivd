import { execa } from "execa";
import * as fs from "fs";
import * as path from "path";

/**
 * Git HTTP Protocol Service
 * Implements the Git smart HTTP protocol by spawning git-upload-pack and git-receive-pack
 * processes and handling their binary streams.
 */
export class GitHttpService {
  private safeDirectoryCache = new Set<string>();

  private async ensureSafeDirectory(repoDir: string): Promise<void> {
    const resolvedRepoDir = path.resolve(repoDir);

    if (this.safeDirectoryCache.has(resolvedRepoDir)) return;

    // When repos are mounted from the host into a container, ownership can differ from the
    // running UID (often root). Git then refuses to operate unless the repo is marked safe.
    // Using absolute paths here is important: some git subcommands (notably upload-pack)
    // can still reject relative paths even if the repo is listed as safe.
    const gitDirCandidate = path.join(resolvedRepoDir, ".git");
    const safeDir = fs.existsSync(gitDirCandidate) ? gitDirCandidate : resolvedRepoDir;

    try {
      await execa("git", ["config", "--global", "--add", "safe.directory", safeDir], {
        encoding: "utf8",
      });
    } catch {
      // Ignore errors; safe.directory might already exist or git might be missing in minimal images.
    }

    // Also add the repo root for good measure (some commands check the worktree path).
    try {
      await execa("git", ["config", "--global", "--add", "safe.directory", resolvedRepoDir], {
        encoding: "utf8",
      });
    } catch {
      // Ignore
    }

    this.safeDirectoryCache.add(resolvedRepoDir);
  }

  /**
   * Get the commit hash from a git repository after push completes
   */
  async getCurrentCommit(versionDir: string): Promise<string | null> {
    try {
      await this.ensureSafeDirectory(versionDir);
      const { stdout } = await execa("git", ["rev-parse", "HEAD"], {
        cwd: versionDir,
        encoding: "utf8",
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Handle info/refs discovery endpoint
   * Returns advertisement of refs (branches, tags) that the git client can use
   * Service parameter: 'git-upload-pack' (for fetch/clone) or 'git-receive-pack' (for push)
   */
  async handleInfoRefs(
    versionDir: string,
    service: string
  ): Promise<Buffer> {
    if (!["git-upload-pack", "git-receive-pack"].includes(service)) {
      throw new Error(`Invalid service: ${service}`);
    }

    try {
      await this.ensureSafeDirectory(versionDir);

      const resolvedRepoDir = path.resolve(versionDir);

      // Spawn git process with --advertise-refs to get the refs advertisement.
      // The output is in git packet-line format but MUST be prefixed with the
      // "# service=..." line + a flush packet for the smart HTTP protocol.
      const { stdout } = await execa(service, ["--stateless-rpc", "--advertise-refs", resolvedRepoDir], {
        cwd: "/",
        encoding: "buffer",
      });

      const advertisement = Buffer.from(stdout);

      const serviceLine = `# service=${service}\n`;
      const pktLen = (Buffer.byteLength(serviceLine, "utf8") + 4)
        .toString(16)
        .padStart(4, "0");
      const pktServiceLine = Buffer.from(`${pktLen}${serviceLine}`, "utf8");
      const flushPacket = Buffer.from("0000", "utf8");

      return Buffer.concat([pktServiceLine, flushPacket, advertisement]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Info refs failed: ${msg}`);
    }
  }

  /**
   * Handle git-upload-pack (clone/fetch/pull)
   * Receives a request body from the git client and returns the pack data
   */
  async handleUploadPack(
    versionDir: string,
    requestBody: Buffer
  ): Promise<Buffer> {
    try {
      await this.ensureSafeDirectory(versionDir);

      const resolvedRepoDir = path.resolve(versionDir);

      const { stdout } = await execa("git-upload-pack", ["--stateless-rpc", resolvedRepoDir], {
        cwd: "/",
        input: requestBody,
        encoding: "buffer",
      });

      return Buffer.from(stdout);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Upload pack failed: ${msg}`);
    }
  }

  /**
   * Handle git-receive-pack (push) with post-push hooks
   * Receives a push from the git client, applies changes to the repository,
   * and executes optional post-success hooks
   */
  async handleReceivePack(
    versionDir: string,
    requestBody: Buffer,
    hooks?: { onSuccess?: (commitHash: string) => Promise<void> }
  ): Promise<Buffer> {
    try {
      await this.ensureSafeDirectory(versionDir);

      const resolvedRepoDir = path.resolve(versionDir);

      // Allow pushes into the checked-out branch for non-bare repositories by updating the
      // worktree in place. This is required because project version directories are working trees.
      try {
        await execa(
          "git",
          ["-C", resolvedRepoDir, "config", "receive.denyCurrentBranch", "updateInstead"],
          { encoding: "utf8" }
        );
      } catch {
        // Ignore if git isn't available or config fails
      }

      const { stdout } = await execa("git-receive-pack", ["--stateless-rpc", resolvedRepoDir], {
        cwd: "/",
        input: requestBody,
        encoding: "buffer",
      });

      // Execute post-push hooks asynchronously (non-blocking)
      if (hooks?.onSuccess) {
        // Get the new commit hash after push completes
        this.getCurrentCommit(versionDir)
          .then((hash) => {
            if (hash) {
              return hooks.onSuccess!(hash);
            }
          })
          .catch((err) => {
            console.error("[GitHttp] Post-push hook error:", err);
          });
      }

      return Buffer.from(stdout);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Receive pack failed: ${msg}`);
    }
  }
}

// Export singleton instance
export const gitHttpService = new GitHttpService();
