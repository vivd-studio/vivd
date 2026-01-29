import { execa } from "execa";
import * as fs from "fs";
import * as path from "path";

/**
 * Git HTTP Protocol Service
 * Implements the Git smart HTTP protocol by spawning git-upload-pack and git-receive-pack
 * processes and handling their binary streams.
 */
export class GitHttpService {
  /**
   * Get the commit hash from a git repository after push completes
   */
  async getCurrentCommit(versionDir: string): Promise<string | null> {
    try {
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
      // Spawn git process with --advertise-refs to get the refs advertisement
      // The output is already in git packet-line format
      const { stdout } = await execa(service, ["--advertise-refs", "."], {
        cwd: versionDir,
        encoding: null, // Binary mode
      });

      return Buffer.from(stdout);
    } catch (error) {
      // If the repository doesn't exist or is empty, git will error
      // Return an empty refs list in packet-line format
      // Format: 4-byte packet size (hex) + data
      // "0000" means end of stream
      const emptyRefs = Buffer.from("0000", "utf8");
      return emptyRefs;
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
      const { stdout } = await execa("git-upload-pack", ["."], {
        cwd: versionDir,
        input: requestBody,
        encoding: null, // Binary mode
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
      const { stdout } = await execa("git-receive-pack", ["."], {
        cwd: versionDir,
        input: requestBody,
        encoding: null, // Binary mode
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
