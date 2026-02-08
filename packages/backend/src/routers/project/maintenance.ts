import { z } from "zod";
import {
  protectedProcedure,
  adminProcedure,
  ownerProcedure,
  projectMemberProcedure,
} from "../../trpc";
import {
  getActiveTenantId,
  getProjectDir,
  getVersionDir,
  getManifest,
  getCurrentVersion,
  getVersionData,
  updateVersionStatus,
  isLegacyProject,
  migrateProjectIfNeeded,
  listProjectSlugs,
  touchProjectUpdatedAt,
  deleteVersion as deleteVersionUtil,
} from "../../generator/versionUtils";
import path from "path";
import fs from "fs";
import { publishService } from "../../services/PublishService";
import { db } from "../../db";
import { projectMember, publishedSite } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { devServerManager } from "../../devserver/devServerManager";
import { serverManager as opencodeServerManager } from "../../opencode/serverManager";
import {
  applyHtmlPatches,
  type HtmlPatch,
} from "../../services/HtmlPatchService";
import {
  applyAstroPatches,
  type AstroTextPatch,
} from "../../services/AstroPatchService";
import {
  applyI18nJsonPatches,
  type I18nJsonPatch,
} from "../../services/I18nJsonPatchService";
import {
  hasDotSegment,
  getVivdInternalFilesPath,
  migrateVivdInternalArtifactsInVersion,
  VIVD_INTERNAL_ARTIFACT_FILENAMES,
} from "../../generator/vivdPaths";
import { thumbnailService } from "../../services/ThumbnailService";
import { applyProjectTemplateFiles } from "../../generator/templateFiles";
import type { GenerationSource } from "../../generator/flows/types";
import {
  createS3Client,
  getObjectStorageConfigFromEnv,
  uploadDirectoryToBucket,
} from "../../services/ObjectStorageService";
import { migrateProjectMetadataToDbFromFilesystem } from "../../services/ProjectMetaMigrationService";

export const projectMaintenanceProcedures = {
  applyHtmlPatches: projectMemberProcedure
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
                type: z.literal("setI18n"),
                key: z.string().min(1),
                lang: z.string().min(2),
                value: z.string(),
              }),
              z.object({
                type: z.literal("setAttr"),
                selector: z.string().min(1),
                name: z.literal("src"),
                value: z.string(),
              }),
              // Astro component text patches - uses source file info from dev server
              z.object({
                type: z.literal("setAstroText"),
                sourceFile: z.string().min(1),
                sourceLoc: z.string().optional(),
                oldValue: z.string(),
                newValue: z.string(),
              }),
            ])
          )
          .min(1, "At least one patch is required"),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, filePath, patches } = input;
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      const absoluteVersionDir = path.resolve(versionDir);

      // Separate patches by type
      const astroPatches = patches.filter(
        (p): p is AstroTextPatch => p.type === "setAstroText"
      );
      const i18nPatches = patches
        .filter(
          (
            p
          ): p is {
            type: "setI18n";
            key: string;
            lang: string;
            value: string;
          } => p.type === "setI18n"
        )
        .map(
          (p): I18nJsonPatch => ({ key: p.key, lang: p.lang, value: p.value })
        );
      // Filter out Astro and i18n patches, keep only HTML patches
      const htmlPatches = patches.filter(
        (p) => p.type !== "setAstroText" && p.type !== "setI18n"
      ) as HtmlPatch[];

      let totalApplied = 0;
      let totalSkipped = 0;
      const allErrors: Array<{
        selector?: string;
        file?: string;
        reason: string;
      }> = [];

      // Apply Astro patches if any
      if (astroPatches.length > 0) {
        // Validate source file paths (security check)
        for (const patch of astroPatches) {
          if (hasDotSegment(patch.sourceFile)) {
            throw new Error("Cannot edit hidden files");
          }
          const resolvedPath = path.resolve(versionDir, patch.sourceFile);
          if (!resolvedPath.startsWith(absoluteVersionDir)) {
            throw new Error("Invalid source file path");
          }
        }

        const astroResult = applyAstroPatches(versionDir, astroPatches);
        totalApplied += astroResult.applied;
        totalSkipped += astroResult.skipped;
        allErrors.push(
          ...astroResult.errors.map((e) => ({ file: e.file, reason: e.reason }))
        );
      }

      // Apply i18n JSON patches if any
      if (i18nPatches.length > 0) {
        const i18nResult = applyI18nJsonPatches(versionDir, i18nPatches);
        totalApplied += i18nResult.applied;
        totalSkipped += i18nResult.skipped;
        allErrors.push(
          ...i18nResult.errors.map((e) => ({
            selector: `i18n:${e.key}`,
            reason: e.reason,
          }))
        );
      }

      // Apply HTML patches if any
      if (htmlPatches.length > 0) {
        if (hasDotSegment(filePath)) {
          throw new Error("Cannot edit hidden files");
        }

        // Security check to prevent directory traversal
        const targetPath = path.join(versionDir, filePath);
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
        const result = applyHtmlPatches(original, htmlPatches);

        if (result.html !== original) {
          fs.writeFileSync(targetPath, result.html, "utf-8");
        }

        totalApplied += result.applied;
        totalSkipped += result.skipped;
        allErrors.push(
          ...result.errors.map((e) => ({
            selector: e.selector,
            reason: e.reason,
          }))
        );
      }

      const noChanges = totalApplied === 0;

      // Update project's updatedAt timestamp if changes were applied
      if (!noChanges) {
        await touchProjectUpdatedAt(slug);
      }

      return {
        success: true,
        noChanges,
        applied: totalApplied,
        skipped: totalSkipped,
        errors: allErrors,
      };
    }),

  /**
   * Admin endpoint to hard reset a stuck project's status.
   * Use this when a project is stuck in a processing state.
   */
  resetStatus: ownerProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const manifest = await getManifest(slug);
      if (!manifest) throw new Error("Project not found");

      const targetVersion = version ?? (await getCurrentVersion(slug));
      if (targetVersion === 0) {
        throw new Error("No versions found for this project");
      }

      const versionData = await getVersionData(slug, targetVersion);
      const currentStatus = versionData?.status || "unknown";

      // Update the status to 'failed'
      await updateVersionStatus(slug, targetVersion, "failed");

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
  migrateVivdProcessFiles: ownerProcedure.mutation(async () => {
    const projectDirs = await listProjectSlugs();
    if (projectDirs.length === 0) {
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
      const manifest = await getManifest(slug);
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
   * Admin maintenance: migrate file-backed project metadata into the database.
   * Imports `manifest.json`, `.vivd/project.json`, `.vivd/publish-checklist.json`, and thumbnail artifacts.
   */
  migrateProjectMetadataToDb: ownerProcedure.mutation(async () => {
    return migrateProjectMetadataToDbFromFilesystem();
  }),

  /**
   * Admin maintenance: ensure project template files (like AGENTS.md, .gitignore) exist in all versions.
   * Can be re-run with overwrite=true to update templates across all projects.
   */
  migrateProjectTemplateFiles: ownerProcedure
    .input(
      z
        .object({
          overwrite: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
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
      const projectDirs = await listProjectSlugs();
      if (projectDirs.length === 0) {
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

        const manifest = await getManifest(slug);
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
              ? await getVersionData(slug, versionNumber)
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

  /**
   * Get application configuration (exposed to frontend)
   */
  getConfig: protectedProcedure.query(() => {
    const domain = process.env.DOMAIN || null;
    return {
      // The current domain where vivd-studio is running
      domain,
      tenantId: getActiveTenantId(),
      github: {
        enabled: process.env.GITHUB_SYNC_ENABLED === "true",
        org: process.env.GITHUB_ORG || null,
        repoPrefix: process.env.GITHUB_REPO_PREFIX || "",
      },
    };
  }),

  /**
   * Admin maintenance: upload all local project versions into object storage (S3/R2)
   * so studio machines can hydrate workspaces from the bucket.
   */
  exportAllProjectsToObjectStorage: ownerProcedure.mutation(async () => {
    const { bucket, endpointUrl, region, accessKeyId, secretAccessKey, sessionToken } =
      getObjectStorageConfigFromEnv();
    const client = createS3Client({
      bucket,
      endpointUrl,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });

    const tenantId = getActiveTenantId();

    const projectDirs = await listProjectSlugs();
    if (projectDirs.length === 0) {
      return {
        success: true,
        bucket,
        endpointUrl: endpointUrl || null,
        tenantId,
        projectsScanned: 0,
        legacyProjectsMigrated: 0,
        versionsScanned: 0,
        versionsExported: 0,
        filesUploaded: 0,
        bytesUploaded: 0,
        errors: [] as Array<{
          slug: string;
          versionDir: string;
          error: string;
        }>,
        fileErrors: [] as Array<{
          slug: string;
          versionDir: string;
          file: string;
          key: string;
          error: string;
        }>,
      };
    }

    let projectsScanned = 0;
    let legacyProjectsMigrated = 0;
    let versionsScanned = 0;
    let versionsExported = 0;
    let filesUploaded = 0;
    let bytesUploaded = 0;

    const errors: Array<{ slug: string; versionDir: string; error: string }> =
      [];
    const fileErrors: Array<{
      slug: string;
      versionDir: string;
      file: string;
      key: string;
      error: string;
    }> = [];

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

      // Keep behavior consistent with other migrations: only process projects with a manifest.
      const manifest = await getManifest(slug);
      if (!manifest) continue;

      const versionFolders = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
        .map((d) => d.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        versionsScanned++;

        if (!fs.existsSync(versionDir)) continue;

        const keyPrefix = `tenants/${tenantId}/projects/${slug}/${folder}/source`;

        try {
          const res = await uploadDirectoryToBucket({
            client,
            bucket,
            localDir: versionDir,
            keyPrefix,
            excludeDirNames: ["node_modules"],
          });

          versionsExported++;
          filesUploaded += res.filesUploaded;
          bytesUploaded += res.bytesUploaded;

          for (const fe of res.errors) {
            fileErrors.push({
              slug,
              versionDir,
              file: fe.file,
              key: fe.key,
              error: fe.error,
            });
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
      bucket,
      endpointUrl: endpointUrl || null,
      tenantId,
      projectsScanned,
      legacyProjectsMigrated,
      versionsScanned,
      versionsExported,
      filesUploaded,
      bytesUploaded,
      errors,
      fileErrors,
    };
  }),

  /**
   * Delete a project permanently.
   * Requires typing the project name to confirm deletion (GitHub-style safety).
   */
  delete: adminProcedure
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

      // Delete project_member records from database
      await db.delete(projectMember).where(eq(projectMember.projectSlug, slug));
      console.log(`[Delete] Removed project_member records for: ${slug}`);

      // Stop any running dev servers for this project (all versions)
      const devServersStopped = devServerManager.stopByProjectPrefix(projectDir);
      if (devServersStopped > 0) {
        console.log(`[Delete] Stopped ${devServersStopped} dev server(s) for: ${slug}`);
      }

      // Stop any running OpenCode servers for this project (all versions)
      const opencodeStopped = await opencodeServerManager.stopByProjectPrefix(projectDir);
      if (opencodeStopped > 0) {
        console.log(`[Delete] Stopped ${opencodeStopped} OpenCode server(s) for: ${slug}`);
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

  /**
   * Delete a specific version of a project.
   * Requires typing "v{N}" to confirm deletion.
   * Cannot delete published versions or the only remaining version.
   */
  deleteVersion: adminProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        confirmationText: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, confirmationText } = input;

      // Safety check: confirmation text must match "v{N}"
      const expectedConfirmation = `v${version}`;
      if (confirmationText !== expectedConfirmation) {
        throw new Error(
          `Confirmation text must be "${expectedConfirmation}". Deletion aborted.`
        );
      }

      const projectDir = getProjectDir(slug);
      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      if (!fs.existsSync(versionDir)) {
        throw new Error(`Version ${version} not found`);
      }

      // Check if this version is published
      const publishedVersions = await db
        .select()
        .from(publishedSite)
        .where(
          and(
            eq(publishedSite.projectSlug, slug),
            eq(publishedSite.projectVersion, version)
          )
        )
        .limit(1);

      if (publishedVersions.length > 0) {
        throw new Error(
          `Cannot delete version ${version} because it is currently published to "${publishedVersions[0].domain}". Please unpublish first.`
        );
      }

      // Check if this is the only version
      const manifest = await getManifest(slug);
      if (!manifest || manifest.versions.length <= 1) {
        throw new Error(
          "Cannot delete the only remaining version. Delete the entire project instead."
        );
      }

      // Stop any running dev servers for this version
      devServerManager.stopDevServer(versionDir);
      console.log(`[DeleteVersion] Stopped dev server for: ${slug}/v${version}`);

      // Stop any running OpenCode servers for this version
      await opencodeServerManager.stopServer(versionDir);
      console.log(`[DeleteVersion] Stopped OpenCode server for: ${slug}/v${version}`);

      // Delete the version using the utility function
      await deleteVersionUtil(slug, version);
      console.log(`[DeleteVersion] Permanently deleted version: ${slug}/v${version}`);

      return {
        success: true,
        slug,
        version,
        message: `Version ${version} of "${slug}" has been permanently deleted.`,
      };
    }),

  /**
   * Untrack build cache directories that should be gitignored.
   * This fixes the issue where .astro/ or other cache dirs were committed
   * before being added to .gitignore.
   */
  fixGitignore: projectMemberProcedure
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

      // Import gitService dynamically to avoid circular deps
      const { gitService } = await import("../../services/GitService");

      // Paths that should be ignored but might have been committed
      const pathsToUntrack = [
        ".astro",
        "node_modules",
        "dist",
        ".next",
        ".nuxt",
        ".output",
      ];

      // Untrack any that are currently tracked
      const result = await gitService.untrackIgnoredPaths(
        versionDir,
        pathsToUntrack
      );

      // If we untracked anything, commit the change
      if (result.untracked.length > 0) {
        await gitService.save(
          versionDir,
          `chore: untrack ${result.untracked.join(", ")} (now in .gitignore)`
        );
      }

      return {
        success: true,
        untracked: result.untracked,
        alreadyUntracked: result.alreadyUntracked,
        message:
          result.untracked.length > 0
            ? `Untracked and committed: ${result.untracked.join(", ")}`
            : "All paths were already untracked",
      };
    }),

  /**
   * Admin maintenance: fix gitignore for all projects.
   * Untracks build cache directories (.astro, node_modules, etc.) that were
   * accidentally committed before being added to .gitignore.
   */
  fixGitignoreAll: ownerProcedure.mutation(async () => {
    const projectDirs = await listProjectSlugs();
    if (projectDirs.length === 0) {
      return {
        success: true,
        projectsScanned: 0,
        versionsScanned: 0,
        versionsFixed: 0,
        totalUntracked: [] as string[],
        errors: [] as Array<{ slug: string; version: number; error: string }>,
      };
    }

    // Import gitService dynamically to avoid circular deps
    const { gitService } = await import("../../services/GitService");

    // Paths that should be ignored but might have been committed
    const pathsToUntrack = [
      ".astro",
      "node_modules",
      "dist",
      ".next",
      ".nuxt",
      ".output",
    ];

    let projectsScanned = 0;
    let versionsScanned = 0;
    let versionsFixed = 0;
    const allUntracked: string[] = [];
    const errors: Array<{ slug: string; version: number; error: string }> = [];

    for (const slug of projectDirs) {
      projectsScanned++;

      const manifest = await getManifest(slug);
      if (!manifest) continue;

      const projectDir = getProjectDir(slug);
      if (!fs.existsSync(projectDir)) continue;

      const versionFolders = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
        .map((d) => d.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        const versionNumber = Number(folder.slice(1));
        versionsScanned++;

        try {
          const result = await gitService.untrackIgnoredPaths(
            versionDir,
            pathsToUntrack
          );

          if (result.untracked.length > 0) {
            await gitService.save(
              versionDir,
              `chore: untrack ${result.untracked.join(", ")} (now in .gitignore)`
            );
            versionsFixed++;
            allUntracked.push(...result.untracked);
          }
        } catch (e) {
          errors.push({
            slug,
            version: versionNumber,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      success: true,
      projectsScanned,
      versionsScanned,
      versionsFixed,
      totalUntracked: [...new Set(allUntracked)], // unique paths
      errors,
    };
  }),

  /**
   * Admin maintenance: regenerate thumbnails for all completed project versions.
   * Processes versions sequentially to avoid overwhelming the scraper service.
   * Only regenerates for versions with status "completed".
   */
  regenerateAllThumbnails: ownerProcedure
    .input(
      z
        .object({
          // If true, only regenerate missing thumbnails. If false, regenerate all.
          onlyMissing: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const onlyMissing = input?.onlyMissing ?? true;
      const projectDirs = await listProjectSlugs();
      if (projectDirs.length === 0) {
        return {
          success: true,
          projectsScanned: 0,
          versionsScanned: 0,
          thumbnailsGenerated: 0,
          thumbnailsSkipped: 0,
          errors: [] as Array<{ slug: string; version: number; error: string }>,
        };
      }

      let projectsScanned = 0;
      let versionsScanned = 0;
      let thumbnailsGenerated = 0;
      let thumbnailsSkipped = 0;
      const errors: Array<{ slug: string; version: number; error: string }> = [];

      for (const slug of projectDirs) {
        projectsScanned++;

        const manifest = await getManifest(slug);
        if (!manifest) continue;

        const projectDir = getProjectDir(slug);
        if (!fs.existsSync(projectDir)) continue;

        const versionFolders = fs
          .readdirSync(projectDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
          .map((d) => d.name);

        for (const folder of versionFolders) {
          const versionNumber = Number(folder.slice(1));
          if (!Number.isFinite(versionNumber) || versionNumber <= 0) continue;

          versionsScanned++;

          const versionDir = path.join(projectDir, folder);
          const versionData = await getVersionData(slug, versionNumber);

          // Only generate thumbnails for completed versions
          if (versionData?.status !== "completed") {
            thumbnailsSkipped++;
            continue;
          }

          // Check if thumbnail already exists (when onlyMissing is true)
          if (onlyMissing) {
            const thumbnailPath = getVivdInternalFilesPath(
              versionDir,
              "thumbnail.webp"
            );
            if (fs.existsSync(thumbnailPath)) {
              thumbnailsSkipped++;
              continue;
            }
          }

          try {
            // Use immediate generation (no debouncing) for batch operations
            await thumbnailService.generateThumbnailImmediate(
              versionDir,
              slug,
              versionNumber
            );
            thumbnailsGenerated++;
            console.log(
              `[Thumbnail] Regenerated ${slug} v${versionNumber} (${thumbnailsGenerated} done)`
            );
          } catch (e) {
            errors.push({
              slug,
              version: versionNumber,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      return {
        success: true,
        projectsScanned,
        versionsScanned,
        thumbnailsGenerated,
        thumbnailsSkipped,
        errors,
      };
    }),
};
