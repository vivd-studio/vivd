import { z } from "zod";
import {
  protectedProcedure,
  adminProcedure,
  ownerProcedure,
  projectMemberProcedure,
} from "../../trpc";
import {
  getProjectDir,
  getVersionDir,
  getManifest,
  getCurrentVersion,
  getVersionData,
  updateVersionStatus,
  isLegacyProject,
  migrateProjectIfNeeded,
  getProjectsDir,
} from "../../generator/versionUtils";
import path from "path";
import fs from "fs";
import { publishService } from "../../services/PublishService";
import {
  applyHtmlPatches,
  type HtmlPatch,
} from "../../services/HtmlPatchService";
import {
  applyAstroPatches,
  type AstroTextPatch,
} from "../../services/AstroPatchService";
import {
  hasDotSegment,
  ensureVivdInternalFilesDir,
  getVivdInternalFilesPath,
  migrateVivdInternalArtifactsInVersion,
  VIVD_INTERNAL_ARTIFACT_FILENAMES,
} from "../../generator/vivdPaths";
import { applyProjectTemplateFiles } from "../../generator/templateFiles";
import type { GenerationSource } from "../../generator/flows/types";

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

      // Separate Astro patches from HTML patches
      const astroPatches = patches.filter(
        (p): p is AstroTextPatch => p.type === "setAstroText"
      );
      // Filter out Astro patches and cast to HtmlPatch[]
      const htmlPatches = patches.filter(
        (p) => p.type !== "setAstroText"
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
  migrateVivdProcessFiles: ownerProcedure.mutation(async () => {
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
        .filter((d) => d.isDirectory() && /^v\\d+$/.test(d.name))
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
  migrateProjectTemplateFiles: ownerProcedure
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
          .filter((d) => d.isDirectory() && /^v\\d+$/.test(d.name))
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

      // Delete the entire project directory
      fs.rmSync(projectDir, { recursive: true, force: true });
      console.log(`[Delete] Permanently deleted project: ${slug}`);

      return {
        success: true,
        slug,
        message: `Project "${slug}" has been permanently deleted.`,
      };
    }),
};
