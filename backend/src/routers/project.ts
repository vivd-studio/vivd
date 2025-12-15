import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../trpc";
import { processUrl } from "../generator/index";
import {
  getProjectDir,
  getVersionDir,
  getManifest,
  getCurrentVersion,
  getNextVersion,
  getVersionData,
  isVersionStale,
  updateVersionStatus,
  PROCESSING_STATUSES,
} from "../generator/versionUtils";
import { initializeGitRepository } from "../generator/gitUtils";
import path from "path";
import fs from "fs";

export const projectRouter = router({
  generate: protectedProcedure
    .input(
      z.object({
        url: z.string().min(1),
        createNewVersion: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { url, createNewVersion } = input;

      // Ensure consistent slug generation
      let targetUrl = url;
      if (!targetUrl.startsWith("http")) targetUrl = "https://" + targetUrl;
      const domainSlug = new URL(targetUrl).hostname
        .replace("www.", "")
        .split(".")[0];
      const projectDir = getProjectDir(domainSlug);

      if (fs.existsSync(projectDir)) {
        const manifest = getManifest(domainSlug);
        const currentVersion = getCurrentVersion(domainSlug);

        if (manifest && currentVersion > 0) {
          // Check if any version is currently processing (but not stale)
          const currentVersionData = getVersionData(domainSlug, currentVersion);
          const status = currentVersionData?.status || "unknown";
          const versionInfo = manifest.versions.find(
            (v) => v.version === currentVersion
          );

          // If status is processing but stale (>30 min), allow regeneration
          const isStale = isVersionStale(versionInfo || currentVersionData);

          if (PROCESSING_STATUSES.includes(status) && !isStale) {
            throw new Error("Project is currently being generated");
          }

          if (!createNewVersion) {
            // Return exists status with version info
            return {
              status: "exists",
              slug: domainSlug,
              currentVersion,
              totalVersions: manifest.versions.length,
              message: "Project already exists",
            };
          }

          // Create new version
          const nextVersion = getNextVersion(domainSlug);
          processUrl(url, nextVersion)
            .then(() => {
              console.log(
                `Finished processing ${url} (version ${nextVersion})`
              );
            })
            .catch((err) => {
              console.error(`Error processing ${url}:`, err);
            });

          return {
            status: "processing",
            slug: domainSlug,
            version: nextVersion,
            message: `Creating version ${nextVersion}`,
          };
        }
      }

      // New project - create version 1
      processUrl(url, 1)
        .then(() => {
          console.log(`Finished processing ${url} (version 1)`);
        })
        .catch((err) => {
          console.error(`Error processing ${url}:`, err);
        });

      return {
        status: "processing",
        slug: domainSlug,
        version: 1,
        message: "Generation started.",
      };
    }),

  regenerate: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const projectDir = getProjectDir(slug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      const targetVersion = version ?? getCurrentVersion(slug);
      if (targetVersion === 0) {
        throw new Error("No versions found for this project");
      }

      const versionDir = getVersionDir(slug, targetVersion);
      const versionData = getVersionData(slug, targetVersion);

      if (!versionData) {
        throw new Error("Version metadata not found");
      }

      const url = versionData.url;
      if (!url) {
        throw new Error("Original URL not found in version metadata");
      }

      // Delete the version directory contents
      if (fs.existsSync(versionDir)) {
        fs.rmSync(versionDir, { recursive: true, force: true });
      }

      // Regenerate the same version
      processUrl(url, targetVersion)
        .then(() => {
          console.log(
            `Finished regenerating ${url} (version ${targetVersion})`
          );
        })
        .catch((err) => {
          console.error(`Error regenerating ${url}:`, err);
        });

      return {
        status: "processing",
        slug,
        version: targetVersion,
        message: `Regenerating version ${targetVersion}`,
      };
    }),

  status: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const projectDir = getProjectDir(slug);

      if (!fs.existsSync(projectDir)) {
        return {
          status: "not_found",
          url: undefined,
          originalUrl: "",
          createdAt: "",
          version: 0,
          totalVersions: 0,
        };
      }

      const manifest = getManifest(slug);
      const targetVersion = version ?? getCurrentVersion(slug);

      if (targetVersion === 0 || !manifest) {
        return {
          status: "not_found",
          url: undefined,
          originalUrl: "",
          createdAt: "",
          version: 0,
          totalVersions: 0,
        };
      }

      const versionData = getVersionData(slug, targetVersion);
      const status = versionData?.status || "unknown";
      const originalUrl = versionData?.url || manifest.url || "";
      const createdAt = versionData?.createdAt || "";

      // Build the preview URL for the specific version
      const resultUrl =
        status === "completed"
          ? `/generated/${slug}/v${targetVersion}/index.html`
          : undefined;

      return {
        status,
        url: resultUrl,
        originalUrl,
        createdAt,
        version: targetVersion,
        totalVersions: manifest.versions.length,
        versions: manifest.versions,
      };
    }),

  list: protectedProcedure.query(async () => {
    const generatedDir = path.join(process.cwd(), "generated");

    if (!fs.existsSync(generatedDir)) {
      return { projects: [] };
    }

    try {
      const files = fs.readdirSync(generatedDir, { withFileTypes: true });
      const projects = files
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => {
          const projectSlug = dirent.name;

          const manifest = getManifest(projectSlug);

          // Only include directories that have a valid manifest (are actual projects)
          if (!manifest) {
            return null;
          }

          // Get data from current version
          const currentVersion = manifest.currentVersion;
          const versionData = getVersionData(projectSlug, currentVersion);

          return {
            slug: projectSlug,
            status: versionData?.status || "unknown",
            url: manifest.url,
            createdAt: manifest.createdAt,
            currentVersion,
            totalVersions: manifest.versions.length,
            versions: manifest.versions,
          };
        })
        .filter(
          (project): project is NonNullable<typeof project> => project !== null
        );
      return { projects };
    } catch (error) {
      console.error("Failed to list projects:", error);
      throw new Error("Failed to list projects");
    }
  }),

  /**
   * One-time migration endpoint to convert legacy projects to versioned structure.
   * This is admin-only and can be removed after all projects are migrated.
   */
  migrateToVersions: adminProcedure.mutation(async () => {
    const generatedDir = path.join(process.cwd(), "generated");

    if (!fs.existsSync(generatedDir)) {
      return {
        success: true,
        migrated: 0,
        skipped: 0,
        total: 0,
        message: "No generated/ directory found. Nothing to migrate.",
      };
    }

    interface ProjectManifest {
      url: string;
      createdAt: string;
      currentVersion: number;
      versions: {
        version: number;
        createdAt: string;
        status: string;
      }[];
    }

    const isLegacyProject = (projectDir: string): boolean => {
      const manifestPath = path.join(projectDir, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        return false;
      }
      const hasDirectFiles =
        fs.existsSync(path.join(projectDir, "index.html")) ||
        fs.existsSync(path.join(projectDir, "project.json"));
      return hasDirectFiles;
    };

    const migrateProject = (slug: string): boolean => {
      const projectDir = path.join(generatedDir, slug);

      if (!isLegacyProject(projectDir)) {
        console.log(
          `  [SKIP] ${slug} - already migrated or not a legacy project`
        );
        return false;
      }

      console.log(`  [MIGRATE] ${slug}...`);

      const v1Dir = path.join(projectDir, "v1");
      fs.mkdirSync(v1Dir, { recursive: true });

      // Read existing project.json if it exists for metadata
      let legacyProjectData: Record<string, unknown> = {};
      const legacyProjectJsonPath = path.join(projectDir, "project.json");
      if (fs.existsSync(legacyProjectJsonPath)) {
        try {
          legacyProjectData = JSON.parse(
            fs.readFileSync(legacyProjectJsonPath, "utf-8")
          );
        } catch (e) {
          console.error(
            `    Error reading legacy project.json for ${slug}:`,
            e
          );
        }
      }

      // Get all items in the project folder
      const items = fs.readdirSync(projectDir, { withFileTypes: true });

      // Move all items to v1 (except v1 itself and manifest.json if somehow exists)
      for (const item of items) {
        if (item.name === "v1" || item.name === "manifest.json") {
          continue;
        }

        const sourcePath = path.join(projectDir, item.name);
        const destPath = path.join(v1Dir, item.name);

        fs.renameSync(sourcePath, destPath);
        console.log(`    Moved: ${item.name}`);
      }

      // Update the project.json in v1 to include version number
      const v1ProjectJsonPath = path.join(v1Dir, "project.json");
      if (fs.existsSync(v1ProjectJsonPath)) {
        try {
          const projectData = JSON.parse(
            fs.readFileSync(v1ProjectJsonPath, "utf-8")
          );
          projectData.version = 1;
          fs.writeFileSync(
            v1ProjectJsonPath,
            JSON.stringify(projectData, null, 2)
          );
        } catch (e) {
          console.error(`    Error updating v1 project.json for ${slug}:`, e);
        }
      }

      // Create manifest
      const manifest: ProjectManifest = {
        url: (legacyProjectData.url as string) || "",
        createdAt:
          (legacyProjectData.createdAt as string) || new Date().toISOString(),
        currentVersion: 1,
        versions: [
          {
            version: 1,
            createdAt:
              (legacyProjectData.createdAt as string) ||
              new Date().toISOString(),
            status: (legacyProjectData.status as string) || "completed",
          },
        ],
      };

      const manifestPath = path.join(projectDir, "manifest.json");
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`    Created manifest.json`);

      console.log(`  [DONE] ${slug} migrated to v1`);
      return true;
    };

    console.log("=== Project Versioning Migration ===\n");

    const items = fs.readdirSync(generatedDir, { withFileTypes: true });
    const projectDirs = items.filter((item) => item.isDirectory());

    console.log(`Found ${projectDirs.length} project(s) to check.\n`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const dir of projectDirs) {
      const migrated = migrateProject(dir.name);
      if (migrated) {
        migratedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log("\n=== Migration Complete ===");
    console.log(`Migrated: ${migratedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`Total: ${projectDirs.length}`);

    return {
      success: true,
      migrated: migratedCount,
      skipped: skippedCount,
      total: projectDirs.length,
      message:
        migratedCount > 0
          ? `Successfully migrated ${migratedCount} project(s) to versioned structure.`
          : "All projects are already migrated.",
    };
  }),

  /**
   * Set the current version for a project (persists to manifest.json)
   */
  setCurrentVersion: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const projectDir = getProjectDir(slug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      const manifest = getManifest(slug);
      if (!manifest) {
        throw new Error("Project manifest not found");
      }

      // Validate that the version exists
      const versionExists = manifest.versions.some(
        (v) => v.version === version
      );
      if (!versionExists) {
        throw new Error(`Version ${version} does not exist for this project`);
      }

      // Update the manifest with new currentVersion
      manifest.currentVersion = version;
      const manifestPath = path.join(projectDir, "manifest.json");
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      return {
        success: true,
        slug,
        currentVersion: version,
        message: `Current version set to ${version}`,
      };
    }),

  /**
   * Admin endpoint to hard reset a stuck project's status.
   * Use this when a project is stuck in a processing state.
   */
  resetStatus: adminProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const projectDir = getProjectDir(slug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      const manifest = getManifest(slug);
      if (!manifest) {
        throw new Error("Project manifest not found");
      }

      const targetVersion = version ?? getCurrentVersion(slug);
      if (targetVersion === 0) {
        throw new Error("No versions found for this project");
      }

      const versionData = getVersionData(slug, targetVersion);
      const currentStatus = versionData?.status || "unknown";

      // Update the status to 'failed'
      updateVersionStatus(slug, targetVersion, "failed");

      // Also update the version-specific project.json if it exists
      const versionDir = getVersionDir(slug, targetVersion);
      const projectJsonPath = path.join(versionDir, "project.json");
      if (fs.existsSync(projectJsonPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
          data.status = "failed";
          fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2));
        } catch (e) {
          console.error(
            `Failed to update project.json for ${slug}/v${targetVersion}:`,
            e
          );
        }
      }

      console.log(
        `[Admin] Reset status for ${slug}/v${targetVersion}: ${currentStatus} -> failed`
      );

      return {
        success: true,
        slug,
        version: targetVersion,
        previousStatus: currentStatus,
        newStatus: "failed",
        message: `Reset ${slug} v${targetVersion} from '${currentStatus}' to 'failed'`,
      };
    }),

  /**
   * Admin endpoint to initialize git in all existing project versions.
   * This is required for OpenCode's undo/revert functionality to work.
   */
  initGitInProjects: adminProcedure.mutation(async () => {
    const generatedDir = path.join(process.cwd(), "generated");

    if (!fs.existsSync(generatedDir)) {
      return {
        success: true,
        initialized: 0,
        skipped: 0,
        failed: 0,
        total: 0,
        message: "No generated/ directory found.",
      };
    }

    console.log("=== Git Initialization Migration ===\n");

    const projectDirs = fs
      .readdirSync(generatedDir, { withFileTypes: true })
      .filter((item) => item.isDirectory());

    let initialized = 0;
    let skipped = 0;
    let failed = 0;
    const details: string[] = [];

    for (const projectDir of projectDirs) {
      const projectPath = path.join(generatedDir, projectDir.name);
      const manifest = getManifest(projectDir.name);

      if (!manifest) {
        console.log(`  [SKIP] ${projectDir.name} - no manifest`);
        skipped++;
        continue;
      }

      // Initialize git in each version directory
      for (const versionInfo of manifest.versions) {
        const versionPath = path.join(projectPath, `v${versionInfo.version}`);

        if (!fs.existsSync(versionPath)) {
          console.log(
            `  [SKIP] ${projectDir.name}/v${versionInfo.version} - directory not found`
          );
          skipped++;
          continue;
        }

        const gitPath = path.join(versionPath, ".git");
        if (fs.existsSync(gitPath)) {
          console.log(
            `  [SKIP] ${projectDir.name}/v${versionInfo.version} - already has git`
          );
          skipped++;
          continue;
        }

        try {
          await initializeGitRepository(
            versionPath,
            "Initial commit (migration)"
          );
          console.log(`  [INIT] ${projectDir.name}/v${versionInfo.version}`);
          initialized++;
          details.push(`${projectDir.name}/v${versionInfo.version}`);
        } catch (error) {
          console.error(
            `  [FAIL] ${projectDir.name}/v${versionInfo.version}:`,
            error
          );
          failed++;
        }
      }
    }

    console.log("\n=== Git Initialization Complete ===");
    console.log(`Initialized: ${initialized}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);

    return {
      success: true,
      initialized,
      skipped,
      failed,
      total: initialized + skipped + failed,
      details,
      message:
        initialized > 0
          ? `Initialized git in ${initialized} version(s).`
          : "All versions already have git or were skipped.",
    };
  }),
});
