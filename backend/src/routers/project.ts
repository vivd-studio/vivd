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
  isLegacyProject,
  migrateProjectIfNeeded,
  getProjectsDir,
} from "../generator/versionUtils";
import { createGenerationContext } from "../generator/core/context";
import { runScratchFlow } from "../generator/flows/scratchFlow";
import { validateConfig } from "../generator/config";
import path from "path";
import fs from "fs";
import { gitService } from "../services/GitService";
import { publishService } from "../services/PublishService";
import { applyHtmlPatches } from "../services/HtmlPatchService";
import {
  hasDotSegment,
  ensureVivdInternalFilesDir,
  getVivdInternalFilesPath,
  migrateVivdInternalArtifactsInVersion,
  VIVD_INTERNAL_ARTIFACT_FILENAMES,
} from "../generator/vivdPaths";
import { applyProjectTemplateFiles } from "../generator/templateFiles";
import type { GenerationSource } from "../generator/flows/types";

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

  generateFromScratch: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        businessType: z.string().optional(),
        stylePreset: z.string().optional(),
        stylePalette: z.array(z.string().min(1)).optional(),
        styleMode: z.enum(["exact", "reference"]).optional(),
        siteTheme: z.enum(["dark", "light"]).optional(),
        referenceUrls: z.array(z.string().min(1)).optional(),
        assets: z
          .array(
            z.object({
              filename: z.string().min(1),
              base64: z.string().min(1),
            })
          )
          .max(20)
          .optional(),
        referenceImages: z
          .array(
            z.object({
              filename: z.string().min(1),
              base64: z.string().min(1),
            })
          )
          .max(20)
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      validateConfig();

      const ctx = createGenerationContext({
        source: "scratch",
        title: input.title,
        description: input.description,
        allowSlugSuffix: true,
        initialStatus: "pending",
      });

      runScratchFlow(ctx, input)
        .then(() => {
          console.log(
            `Finished scratch generation for ${ctx.slug} (version ${ctx.version})`
          );
        })
        .catch((err) => {
          console.error(
            `Error during scratch generation for ${ctx.slug}:`,
            err
          );
          try {
            ctx.updateStatus("failed");
          } catch {
            // ignore
          }
        });

      return {
        status: "processing",
        slug: ctx.slug,
        version: ctx.version,
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
      const sourceRaw = (manifest as any).source as string | undefined;
      const title =
        (versionData as any)?.title ||
        ((manifest as any).title as string | undefined) ||
        "";
      const source: "url" | "scratch" =
        sourceRaw === "scratch" ? "scratch" : manifest.url ? "url" : "scratch";

      // On preview open, sync from GitHub (best-effort).
      // Skips automatically if there are local uncommitted changes.
      if (status === "completed") {
        const versionDir = getVersionDir(slug, targetVersion);
        if (fs.existsSync(versionDir)) {
          await gitService.syncPullFromGitHub({
            cwd: versionDir,
            slug,
            version: targetVersion,
          });
        }
      }

      // Build the preview URL for the specific version
      const resultUrl =
        status === "completed"
          ? `/projects/${slug}/v${targetVersion}/index.html`
          : undefined;

      return {
        status,
        url: resultUrl,
        originalUrl,
        source,
        title,
        createdAt,
        version: targetVersion,
        totalVersions: manifest.versions.length,
        versions: manifest.versions,
      };
    }),

  list: protectedProcedure.query(async () => {
    const projectsDir = getProjectsDir();

    if (!fs.existsSync(projectsDir)) {
      return { projects: [] };
    }

    try {
      // Fetch all published sites upfront for efficient lookup
      const publishedSites = await publishService.getAllPublishedSites();

      const files = fs.readdirSync(projectsDir, { withFileTypes: true });
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
          const sourceRaw = (manifest as any).source as string | undefined;
          const title =
            (versionData as any)?.title ||
            ((manifest as any).title as string | undefined) ||
            "";
          const source: "url" | "scratch" =
            sourceRaw === "scratch"
              ? "scratch"
              : manifest.url
              ? "url"
              : "scratch";

          // Get publish info for this project
          const publishInfo = publishedSites.get(projectSlug);

          return {
            slug: projectSlug,
            status: versionData?.status || "unknown",
            url: manifest.url,
            source,
            title,
            createdAt: manifest.createdAt,
            currentVersion,
            totalVersions: manifest.versions.length,
            versions: manifest.versions,
            // Add publish info
            publishedDomain: publishInfo?.domain ?? null,
            publishedVersion: publishInfo?.projectVersion ?? null,
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

  applyHtmlPatches: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        filePath: z.string().default("index.html"),
        patches: z
          .array(
            z.discriminatedUnion("type", [
              z.object({
                type: z.literal("setTextNode"),
                selector: z.string().min(1),
                index: z.number().int().min(1),
                value: z.string(),
              }),
              z.object({
                type: z.literal("setAttr"),
                selector: z.string().min(1),
                name: z.literal("src"),
                value: z.string(),
              }),
            ])
          )
          .min(1, "At least one patch is required"),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, filePath, patches } = input;
      if (hasDotSegment(filePath)) {
        throw new Error("Cannot edit hidden files");
      }
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      // Security check to prevent directory traversal
      const targetPath = path.join(versionDir, filePath);

      // Ensure the version directory path is resolved to handle potential symlinks/relative paths correctly for comparison
      // limiting scope to the version directory
      const absoluteVersionDir = path.resolve(versionDir);
      const resolvedPath = path.resolve(targetPath);

      if (!resolvedPath.startsWith(absoluteVersionDir)) {
        throw new Error("Invalid file path");
      }

      if (!filePath.endsWith(".html") && !filePath.endsWith(".htm")) {
        throw new Error("Only HTML files can be patched");
      }

      if (!fs.existsSync(targetPath)) {
        throw new Error("File not found");
      }

      const original = fs.readFileSync(targetPath, "utf-8");
      const result = applyHtmlPatches(original, patches);

      if (result.html === original) {
        return {
          success: true,
          noChanges: true,
          applied: 0,
          skipped: result.skipped,
          errors: result.errors,
        };
      }

      fs.writeFileSync(targetPath, result.html, "utf-8");

      return {
        success: true,
        noChanges: false,
        applied: result.applied,
        skipped: result.skipped,
        errors: result.errors,
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
      const readPath = getVivdInternalFilesPath(versionDir, "project.json");
      if (fs.existsSync(readPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(readPath, "utf-8"));
          data.status = "failed";
          ensureVivdInternalFilesDir(versionDir);
          fs.writeFileSync(readPath, JSON.stringify(data, null, 2));
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
   * Admin maintenance: move vivd process files into `.vivd/` for all versions.
   * Keeps the version root clean and prevents accidental public access to process artifacts.
   */
  migrateVivdProcessFiles: adminProcedure.mutation(async () => {
    const projectsDir = getProjectsDir();
    if (!fs.existsSync(projectsDir)) {
      return {
        success: true,
        projectsScanned: 0,
        legacyProjectsMigrated: 0,
        versionsScanned: 0,
        versionsTouched: 0,
        moved: Object.fromEntries(
          VIVD_INTERNAL_ARTIFACT_FILENAMES.map((f) => [f, 0])
        ),
        movedToLegacy: Object.fromEntries(
          VIVD_INTERNAL_ARTIFACT_FILENAMES.map((f) => [f, 0])
        ),
        errors: [] as Array<{
          slug: string;
          versionDir: string;
          error: string;
        }>,
      };
    }

    const moved: Record<string, number> = Object.fromEntries(
      VIVD_INTERNAL_ARTIFACT_FILENAMES.map((f) => [f, 0])
    );
    const movedToLegacy: Record<string, number> = Object.fromEntries(
      VIVD_INTERNAL_ARTIFACT_FILENAMES.map((f) => [f, 0])
    );

    let projectsScanned = 0;
    let legacyProjectsMigrated = 0;
    let versionsScanned = 0;
    let versionsTouched = 0;
    const errors: Array<{ slug: string; versionDir: string; error: string }> =
      [];

    const projectDirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const slug of projectDirs) {
      projectsScanned++;

      try {
        if (isLegacyProject(slug)) {
          const did = migrateProjectIfNeeded(slug);
          if (did) legacyProjectsMigrated++;
        }
      } catch (e) {
        errors.push({
          slug,
          versionDir: getProjectDir(slug),
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      const projectDir = getProjectDir(slug);
      if (!fs.existsSync(projectDir)) continue;

      // Only treat directories with a manifest as projects; legacy projects are handled above.
      const manifest = getManifest(slug);
      if (!manifest) continue;

      const versionFolders = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
        .map((d) => d.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        versionsScanned++;

        try {
          const res = migrateVivdInternalArtifactsInVersion(versionDir);
          if (res.moved.length || res.movedToLegacy.length) versionsTouched++;
          for (const item of res.moved) moved[item.filename]++;
          for (const item of res.movedToLegacy) movedToLegacy[item.filename]++;
        } catch (e) {
          errors.push({
            slug,
            versionDir,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      success: true,
      projectsScanned,
      legacyProjectsMigrated,
      versionsScanned,
      versionsTouched,
      moved,
      movedToLegacy,
      errors,
    };
  }),

  /**
   * Admin maintenance: ensure project template files (like AGENTS.md, .gitignore) exist in all versions.
   * Can be re-run with overwrite=true to update templates across all projects.
   */
  migrateProjectTemplateFiles: adminProcedure
    .input(
      z
        .object({
          overwrite: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const projectsDir = getProjectsDir();
      const overwrite = input?.overwrite ?? false;

      const written: Record<string, number> = {
        "AGENTS.md": 0,
        ".gitignore": 0,
      };

      let projectsScanned = 0;
      let legacyProjectsMigrated = 0;
      let versionsScanned = 0;
      let versionsTouched = 0;
      const errors: Array<{ slug: string; versionDir: string; error: string }> =
        [];

      if (!fs.existsSync(projectsDir)) {
        return {
          success: true,
          projectsScanned,
          legacyProjectsMigrated,
          versionsScanned,
          versionsTouched,
          written,
          errors,
        };
      }

      const projectDirs = fs
        .readdirSync(projectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const slug of projectDirs) {
        projectsScanned++;

        try {
          if (isLegacyProject(slug)) {
            const did = migrateProjectIfNeeded(slug);
            if (did) legacyProjectsMigrated++;
          }
        } catch (e) {
          errors.push({
            slug,
            versionDir: getProjectDir(slug),
            error: e instanceof Error ? e.message : String(e),
          });
          continue;
        }

        const manifest = getManifest(slug);
        if (!manifest) continue;

        const projectDir = getProjectDir(slug);
        if (!fs.existsSync(projectDir)) continue;

        const versionFolders = fs
          .readdirSync(projectDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
          .map((d) => d.name);

        for (const folder of versionFolders) {
          const versionDir = path.join(projectDir, folder);
          versionsScanned++;

          const versionNumber = Number(folder.slice(1));
          const versionData =
            Number.isFinite(versionNumber) && versionNumber > 0
              ? getVersionData(slug, versionNumber)
              : null;

          const rawSource = (versionData?.source ??
            (manifest as any).source) as unknown;
          const source: GenerationSource =
            rawSource === "scratch" || rawSource === "url"
              ? rawSource
              : manifest.url
              ? "url"
              : "scratch";

          const projectName =
            (versionData?.title || (manifest as any).title || slug)?.trim?.() ||
            slug;

          try {
            const res = applyProjectTemplateFiles({
              versionDir,
              source,
              projectName,
              overwrite,
            });
            if (res.written.length) versionsTouched++;
            for (const f of res.written) {
              written[f] = (written[f] ?? 0) + 1;
            }
          } catch (e) {
            errors.push({
              slug,
              versionDir,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      return {
        success: true,
        projectsScanned,
        legacyProjectsMigrated,
        versionsScanned,
        versionsTouched,
        written,
        errors,
      };
    }),

  // ============================================
  // Git-Based Save System (Phase 2.1)
  // ============================================

  /**
   * Save current changes as a git commit.
   */
  gitSave: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        message: z.string().min(1, "Commit message is required"),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, message } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      const result = await gitService.save(versionDir, message);
      const github = await gitService.syncPushToGitHub({
        cwd: versionDir,
        slug,
        version,
      });

      if (result.noChanges) {
        return {
          success: true,
          hash: result.hash,
          noChanges: true,
          github,
          message: "No changes to save",
        };
      }

      return {
        success: result.success,
        hash: result.hash,
        noChanges: false,
        github,
        message: `Saved version with commit ${result.hash.substring(0, 7)}`,
      };
    }),

  /**
   * Get git commit history for a project version.
   */
  gitHistory: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        return { commits: [] };
      }

      const commits = await gitService.getHistory(versionDir);
      return { commits };
    }),

  /**
   * Load/restore files from a specific git commit.
   */
  gitLoadVersion: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        commitHash: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, commitHash } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      await gitService.loadVersion(versionDir, commitHash);
      return {
        success: true,
        message: `Restored to commit ${commitHash.substring(0, 7)}`,
      };
    }),

  /**
   * Check if there are uncommitted changes in a project version.
   */
  gitHasChanges: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        return { hasChanges: false };
      }

      const hasChanges = await gitService.hasUncommittedChanges(versionDir);
      return { hasChanges };
    }),

  /**
   * Get the current HEAD commit hash for a project version.
   */
  gitCurrentCommit: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        return { hash: null };
      }

      const hash = await gitService.getCurrentCommit(versionDir);
      return { hash };
    }),

  /**
   * Get the working commit (the commit whose files are in the working directory).
   * This may differ from HEAD if an older version was loaded.
   */
  gitWorkingCommit: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        return { hash: null };
      }

      // Get the working commit (from marker file if set, otherwise null)
      const workingHash = gitService.getWorkingCommit(versionDir);

      // If no marker, fall back to HEAD (current commit)
      if (!workingHash) {
        const headHash = await gitService.getCurrentCommit(versionDir);
        return { hash: headHash };
      }

      return { hash: workingHash };
    }),

  /**
   * Discard all uncommitted changes for a project version.
   */
  gitDiscardChanges: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      await gitService.discardChanges(versionDir);
      return {
        success: true,
        message: "All changes discarded",
      };
    }),

  // ============================================
  // Publishing System (Phase 2.3)
  // ============================================

  /**
   * Publish a project version to a custom domain
   */
  publish: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        domain: z.string().min(1, "Domain is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { slug, version, domain } = input;
      const userId = ctx.session.user.id;

      const result = await publishService.publish({
        projectSlug: slug,
        version,
        domain,
        userId,
      });

      return result;
    }),

  /**
   * Unpublish a project (remove from domain)
   */
  unpublish: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug } = input;

      await publishService.unpublish(slug);

      return {
        success: true,
        message: "Site unpublished successfully",
      };
    }),

  /**
   * Get publish status for a project
   */
  publishStatus: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
      })
    )
    .query(async ({ input }) => {
      const { slug } = input;

      const info = await publishService.getPublishedInfo(slug);

      if (!info) {
        return {
          isPublished: false,
          domain: null,
          commitHash: null,
          publishedAt: null,
          url: null,
        };
      }

      // Determine URL scheme based on domain type
      const urlScheme = publishService.isDevDomain(info.domain)
        ? "http"
        : "https";

      return {
        isPublished: true,
        domain: info.domain,
        commitHash: info.commitHash,
        publishedAt: info.publishedAt.toISOString(),
        url: `${urlScheme}://${info.domain}`,
        projectVersion: info.projectVersion,
      };
    }),

  /**
   * Get application configuration (exposed to frontend)
   */
  getConfig: protectedProcedure.query(() => {
    const domain = process.env.DOMAIN || null;
    return {
      // The current domain where vivd-studio is running
      domain,
    };
  }),

  /**
   * Check if a domain is available for publishing
   */
  checkDomain: protectedProcedure
    .input(
      z.object({
        domain: z.string(),
        slug: z.string().optional(), // Current project slug for exclusion
      })
    )
    .query(async ({ input }) => {
      const { domain, slug } = input;

      // Normalize and validate
      const normalized = publishService.normalizeDomain(domain);
      const validation = publishService.validateDomain(normalized);

      if (!validation.valid) {
        return {
          available: false,
          normalizedDomain: normalized,
          error: validation.error,
        };
      }

      const available = await publishService.isDomainAvailable(
        normalized,
        slug
      );

      return {
        available,
        normalizedDomain: normalized,
        error: available ? undefined : "Domain is already in use",
      };
    }),

  /**
   * Delete a project permanently.
   * Requires typing the project name to confirm deletion (GitHub-style safety).
   */
  delete: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        confirmationText: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, confirmationText } = input;

      // Safety check: confirmation text must match the project slug
      if (confirmationText !== slug) {
        throw new Error(
          "Confirmation text does not match the project name. Deletion aborted."
        );
      }

      const projectDir = getProjectDir(slug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      // Check if project is published - cannot delete published projects
      const publishInfo = await publishService.getPublishedInfo(slug);
      if (publishInfo) {
        throw new Error(
          `Cannot delete a published project. Please unpublish "${publishInfo.domain}" first.`
        );
      }

      // Delete the entire project directory
      fs.rmSync(projectDir, { recursive: true, force: true });
      console.log(`[Delete] Permanently deleted project: ${slug}`);

      return {
        success: true,
        slug,
        message: `Project "${slug}" has been permanently deleted.`,
      };
    }),
});
