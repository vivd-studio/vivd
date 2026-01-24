import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { detectProjectType, hasNodeModules } from "../devserver/projectType";
import { gitService } from "./GitService";
import { thumbnailService } from "./ThumbnailService";

/**
 * Parse slug and version from a version directory path.
 * Path format: .../projects/<slug>/v<N>/...
 */
function parseVersionDir(versionDir: string): { slug: string; version: number } | null {
  const normalized = versionDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const match = normalized.match(/\/([^/]+)\/v(\d+)$/);
  if (!match) return null;
  return { slug: match[1], version: parseInt(match[2], 10) };
}

export interface BuildInfo {
  status: "pending" | "building" | "ready" | "error";
  commitHash: string;
  outputPath: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

/**
 * Service for managing project builds.
 * Handles async builds for Astro projects with commit-based caching.
 */
class BuildService {
  private builds: Map<string, BuildInfo> = new Map();

  /**
   * Trigger a build in the background (fire-and-forget).
   * Returns immediately - check getBuildStatus() to monitor progress.
   * Skips if already built for the same commit.
   */
  async triggerBuild(
    versionDir: string,
    commitHash: string,
    outputDir = "dist"
  ): Promise<void> {
    const existing = this.builds.get(versionDir);

    // Skip if already building or ready for the same commit
    if (existing && existing.commitHash === commitHash) {
      if (existing.status === "building" || existing.status === "ready") {
        console.log(
          `[Build] Skipping build for ${versionDir} - already ${existing.status} for commit ${commitHash.substring(0, 7)}`
        );
        return;
      }
    }

    const outputPath = path.join(versionDir, outputDir);

    // Set pending status
    this.builds.set(versionDir, {
      status: "pending",
      commitHash,
      outputPath,
      startedAt: Date.now(),
    });

    // Run build in background
    this.runBuild(versionDir, commitHash, outputPath).catch((err) => {
      console.error(`[Build] Background build failed for ${versionDir}:`, err);
    });
  }

  /**
   * Get the current build status for a project.
   */
  getBuildStatus(versionDir: string): BuildInfo | null {
    return this.builds.get(versionDir) || null;
  }

  /**
   * Get the build output path if the build is ready, null otherwise.
   * Also checks if dist/ exists on disk (survives server restarts).
   */
  getBuildPath(versionDir: string): string | null {
    const build = this.builds.get(versionDir);
    if (build && build.status === "ready") {
      return build.outputPath;
    }

    // Check if dist/ exists on disk (handles server restarts)
    const distPath = path.join(versionDir, "dist");
    if (fs.existsSync(distPath) && fs.existsSync(path.join(distPath, "index.html"))) {
      return distPath;
    }

    return null;
  }

  /**
   * Run a build synchronously (blocking).
   * Used for publish where we need to wait for the build to complete.
   */
  async buildSync(versionDir: string, outputDir = "dist"): Promise<string> {
    const config = detectProjectType(versionDir);

    if (config.framework !== "astro") {
      // Non-Astro projects don't need building
      return versionDir;
    }

    // Install dependencies if needed
    if (!hasNodeModules(versionDir)) {
      console.log(`[Build] Installing dependencies in ${versionDir}`);

      const installCmd =
        config.packageManager === "pnpm"
          ? "pnpm install"
          : config.packageManager === "yarn"
            ? "yarn install"
            : "npm install";

      try {
        execSync(installCmd, {
          cwd: versionDir,
          stdio: "pipe",
          encoding: "utf-8",
          timeout: 5 * 60 * 1000, // 5 minute timeout for install
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to install dependencies: ${msg}`);
      }
    }

    // Run astro build with custom output directory
    console.log(
      `[Build] Building Astro project in ${versionDir} to ${outputDir}`
    );
    const astroBin = path.join(versionDir, "node_modules", ".bin", "astro");
    const outputPath = path.join(versionDir, outputDir);

    try {
      execSync(`"${astroBin}" build --outDir "${outputDir}"`, {
        cwd: versionDir,
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 5 * 60 * 1000, // 5 minute timeout for build
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Astro build failed: ${msg}`);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error("Astro build completed but output folder not found");
    }

    console.log(`[Build] Astro build completed, output in ${outputPath}`);
    return outputPath;
  }

  /**
   * Internal method to run the build and update status.
   */
  private async runBuild(
    versionDir: string,
    commitHash: string,
    outputPath: string
  ): Promise<void> {
    // Update status to building
    this.builds.set(versionDir, {
      status: "building",
      commitHash,
      outputPath,
      startedAt: Date.now(),
    });

    try {
      const config = detectProjectType(versionDir);

      // Install dependencies if needed
      if (!hasNodeModules(versionDir)) {
        console.log(`[Build] Installing dependencies in ${versionDir}`);

        const installCmd =
          config.packageManager === "pnpm"
            ? "pnpm install"
            : config.packageManager === "yarn"
              ? "yarn install"
              : "npm install";

        execSync(installCmd, {
          cwd: versionDir,
          stdio: "pipe",
          encoding: "utf-8",
          timeout: 5 * 60 * 1000,
        });
      }

      // Run astro build
      console.log(`[Build] Building Astro project in ${versionDir}`);
      const astroBin = path.join(versionDir, "node_modules", ".bin", "astro");
      const outputDir = path.basename(outputPath);

      execSync(`"${astroBin}" build --outDir "${outputDir}"`, {
        cwd: versionDir,
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 5 * 60 * 1000,
      });

      if (!fs.existsSync(outputPath)) {
        throw new Error("Astro build completed but output folder not found");
      }

      // Update status to ready
      this.builds.set(versionDir, {
        status: "ready",
        commitHash,
        outputPath,
        startedAt: this.builds.get(versionDir)?.startedAt || Date.now(),
        completedAt: Date.now(),
      });

      console.log(
        `[Build] Build completed for ${versionDir} (commit ${commitHash.substring(0, 7)})`
      );

      // Generate thumbnail after successful build
      const parsed = parseVersionDir(versionDir);
      if (parsed) {
        thumbnailService
          .generateThumbnail(versionDir, parsed.slug, parsed.version)
          .catch((err) => {
            console.error("[Thumbnail] Post-build warning:", err.message);
          });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Build] Build failed for ${versionDir}:`, msg);

      // Update status to error
      this.builds.set(versionDir, {
        status: "error",
        commitHash,
        outputPath,
        startedAt: this.builds.get(versionDir)?.startedAt || Date.now(),
        completedAt: Date.now(),
        error: msg,
      });
    }
  }

  /**
   * Mark a build as ready (used after buildSync completes).
   */
  markBuildReady(versionDir: string, commitHash: string, outputPath: string): void {
    this.builds.set(versionDir, {
      status: "ready",
      commitHash,
      outputPath,
      startedAt: Date.now(),
      completedAt: Date.now(),
    });
  }

  /**
   * Invalidate the build cache for a project.
   * Called when files change and a new build is needed.
   */
  invalidateBuild(versionDir: string): void {
    this.builds.delete(versionDir);
  }

  /**
   * Check if a build exists and is up-to-date for the given commit.
   */
  async isBuiltForCommit(
    versionDir: string,
    commitHash?: string
  ): Promise<boolean> {
    const build = this.builds.get(versionDir);
    if (!build || build.status !== "ready") {
      return false;
    }

    // If no commit hash provided, get the current one
    const targetHash = commitHash || (await gitService.getCurrentCommit(versionDir));
    if (!targetHash) {
      return false;
    }

    return build.commitHash === targetHash;
  }
}

// Export singleton instance
export const buildService = new BuildService();
