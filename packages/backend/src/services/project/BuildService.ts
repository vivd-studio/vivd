import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ensureReferencedAstroCmsToolkit } from "@vivd/shared/cms";
import { detectProjectType, hasNodeModules } from "../../devserver/projectType";
import { gitService } from "../integrations/GitService";
import { thumbnailService } from "./ThumbnailService";
import { uploadProjectPreviewToBucket } from "./ProjectArtifactsService";

type ProjectTypeConfig = ReturnType<typeof detectProjectType>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getInstallCommand(config: ProjectTypeConfig): string {
  if (config.packageManager === "pnpm") return "pnpm install";
  if (config.packageManager === "yarn") return "yarn install";
  return "npm install --include=optional";
}

function installDependencies(
  versionDir: string,
  config: ProjectTypeConfig,
): void {
  console.log(`[Build] Installing dependencies in ${versionDir}`);

  try {
    execSync(getInstallCommand(config), {
      cwd: versionDir,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
    });
  } catch (err) {
    throw new Error(`Failed to install dependencies: ${getErrorMessage(err)}`);
  }
}

function runAstroBuild(versionDir: string, outputDir: string): void {
  const astroBin = path.join(versionDir, "node_modules", ".bin", "astro");
  execSync(`"${astroBin}" build --outDir "${outputDir}"`, {
    cwd: versionDir,
    stdio: "pipe",
    encoding: "utf-8",
    timeout: 5 * 60 * 1000,
  });
}

function isMissingRollupNativeDependency(message: string): boolean {
  return (
    message.includes("Cannot find module @rollup/rollup-") ||
    (message.includes("@rollup/rollup-") &&
      message.includes("MODULE_NOT_FOUND"))
  );
}

function resetNpmInstallArtifacts(versionDir: string): void {
  fs.rmSync(path.join(versionDir, "node_modules"), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(versionDir, "package-lock.json"), { force: true });
}

function buildAstroWithNativeRetry(
  versionDir: string,
  outputDir: string,
  config: ProjectTypeConfig,
): void {
  try {
    runAstroBuild(versionDir, outputDir);
    return;
  } catch (err) {
    const message = getErrorMessage(err);
    if (
      config.packageManager !== "npm" ||
      !isMissingRollupNativeDependency(message)
    ) {
      throw new Error(`Astro build failed: ${message}`);
    }

    console.warn(
      `[Build] Missing Rollup native optional dependency in ${versionDir}; reinstalling npm dependencies without the existing lockfile.`,
    );
    resetNpmInstallArtifacts(versionDir);
    installDependencies(versionDir, config);

    try {
      runAstroBuild(versionDir, outputDir);
    } catch (retryErr) {
      throw new Error(
        `Astro build failed after reinstalling dependencies: ${getErrorMessage(retryErr)}`,
      );
    }
  }
}

/**
 * Parse slug and version from a version directory path.
 * Path formats:
 * - .../projects/tenants/<orgId>/<slug>/v<N>
 * - .../projects/<slug>/v<N> (legacy)
 */
function parseVersionDir(versionDir: string): {
  organizationId: string;
  slug: string;
  version: number;
} | null {
  const normalized = versionDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const tenantMatch = normalized.match(/\/tenants\/([^/]+)\/([^/]+)\/v(\d+)$/);
  if (tenantMatch) {
    return {
      organizationId: tenantMatch[1] ?? "default",
      slug: tenantMatch[2],
      version: parseInt(tenantMatch[3] ?? "0", 10),
    };
  }

  const legacyMatch = normalized.match(/\/([^/]+)\/v(\d+)$/);
  if (!legacyMatch) return null;
  return {
    organizationId: "default",
    slug: legacyMatch[1],
    version: parseInt(legacyMatch[2] ?? "0", 10),
  };
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

    const toolkitRepair = await ensureReferencedAstroCmsToolkit(versionDir);
    if (toolkitRepair && toolkitRepair.created.length > 0) {
      console.log(
        `[Build] Ensured local CMS toolkit for ${versionDir}: ${toolkitRepair.created.join(", ")}`,
      );
    }

    if (!hasNodeModules(versionDir)) {
      installDependencies(versionDir, config);
    }

    // Run astro build with custom output directory
    console.log(
      `[Build] Building Astro project in ${versionDir} to ${outputDir}`
    );
    const outputPath = path.join(versionDir, outputDir);

    buildAstroWithNativeRetry(versionDir, outputDir, config);

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

      if (config.framework === "astro") {
        const toolkitRepair = await ensureReferencedAstroCmsToolkit(versionDir);
        if (toolkitRepair && toolkitRepair.created.length > 0) {
          console.log(
            `[Build] Ensured local CMS toolkit for ${versionDir}: ${toolkitRepair.created.join(", ")}`,
          );
        }
      }

      if (!hasNodeModules(versionDir)) {
        installDependencies(versionDir, config);
      }

      // Run astro build
      console.log(`[Build] Building Astro project in ${versionDir}`);
      const outputDir = path.basename(outputPath);
      buildAstroWithNativeRetry(versionDir, outputDir, config);

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

      // Sync preview artifacts to object storage (best-effort).
      const parsed = parseVersionDir(versionDir);
      if (parsed) {
        const startedAt = this.builds.get(versionDir)?.startedAt;
        await uploadProjectPreviewToBucket({
          organizationId: parsed.organizationId,
          localDir: outputPath,
          slug: parsed.slug,
          version: parsed.version,
          meta: {
            status: "ready",
            framework: "astro",
            commitHash,
            startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
            completedAt: new Date().toISOString(),
          },
        }).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[Build] Preview artifact upload failed: ${message}`);
        });
      }

      // Generate thumbnail after successful build
      if (parsed) {
        thumbnailService
          .generateThumbnail(
            versionDir,
            parsed.organizationId,
            parsed.slug,
            parsed.version,
          )
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
