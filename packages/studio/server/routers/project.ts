import { router, publicProcedure } from "../trpc/trpc.js";
import { z } from "zod";
import { simpleGit } from "simple-git";
import path from "path";
import fs from "fs";
import {
  applyHtmlPatches,
  type HtmlPatch,
} from "../services/HtmlPatchService.js";
import {
  applyAstroPatches,
  extractAstroPatches,
  hasAstroPatches,
  type AstroTextPatch,
} from "../services/AstroPatchService.js";
import {
  applyI18nJsonPatches,
  extractI18nPatches,
  hasI18nPatches,
  type I18nJsonPatch,
} from "../services/I18nJsonPatchService.js";
import { devServerService } from "../services/DevServerService.js";
import { detectProjectType } from "../services/projectType.js";
import {
  buildAndUploadPreview,
  buildAndUploadPublished,
  syncSourceToBucket,
} from "../services/ArtifactSyncService.js";
import { projectTouchReporter } from "../services/ProjectTouchReporter.js";
import { thumbnailGenerationReporter } from "../services/ThumbnailGenerationReporter.js";

// Dotfiles that are allowed in asset paths
const ALLOWED_DOTFILES = [".vivd", ".gitignore", ".env.example"];

function hasDotSegment(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.some(
    (segment) =>
      segment.startsWith(".") && !ALLOWED_DOTFILES.includes(segment)
  );
}

export const projectRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.workspace.isInitialized()) {
      return { projects: [] };
    }

    return {
      projects: [
        {
          slug: "studio",
          status: "completed",
          url: null,
          source: "scratch",
          title: "studio",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentVersion: 1,
          totalVersions: 1,
          versions: [{ version: 1, status: "completed" }],
          publishedDomain: null,
          publishedVersion: null,
          thumbnailUrl: null,
        },
      ],
    };
  }),

  getPreviewInfo: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return {
          mode: "static" as const,
          status: "starting" as const,
          url: `/vivd-studio/api/preview/${input.slug}/v${input.version}/index.html`,
          error: "Workspace not initialized",
        };
      }

      const projectDir = ctx.workspace.getProjectPath();
      const config = detectProjectType(projectDir);

      if (config.mode === "static") {
        return {
          mode: "static" as const,
          status: "ready" as const,
          url: `/vivd-studio/api/preview/${input.slug}/v${input.version}/index.html`,
        };
      }

      const basePath = `/vivd-studio/api/devpreview/${input.slug}/v${input.version}`;
      const result = await devServerService.getOrStartDevServer(
        projectDir,
        basePath,
      );

      return {
        mode: "devserver" as const,
        status: result.status,
        url: `${basePath}/`,
        error: result.error,
      };
    }),

  keepAliveDevServer: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return { success: false };
      }

      devServerService.touch();
      return { success: true };
    }),

  stopDevServer: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async () => {
      devServerService.stopDevServer();
      return { success: true };
    }),

  applyHtmlPatches: publicProcedure
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
              z.object({
                type: z.literal("setAstroText"),
                sourceFile: z.string().min(1),
                sourceLoc: z.string().optional(),
                oldValue: z.string(),
                newValue: z.string(),
              }),
            ]),
          )
          .min(1, "At least one patch is required"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      if (hasDotSegment(input.filePath)) {
        throw new Error("Invalid file path");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const targetPath = path.join(projectDir, input.filePath);

      // Separate patches by type
      const astroPatches = input.patches.filter(
        (p): p is { type: "setAstroText" } & AstroTextPatch =>
          p.type === "setAstroText",
      );
      const i18nPatches = extractI18nPatches(input.patches).map(
        (p): I18nJsonPatch => ({ key: p.key, lang: p.lang, value: p.value }),
      );
      const htmlPatches = input.patches.filter(
        (p): p is HtmlPatch => p.type === "setTextNode" || p.type === "setAttr",
      );

      let totalApplied = 0;
      let totalSkipped = 0;
      const allErrors: Array<{ selector: string; reason: string }> = [];

      // Apply Astro patches
      if (hasAstroPatches(input.patches)) {
        const result = applyAstroPatches(projectDir, astroPatches);
        totalApplied += result.applied;
        totalSkipped += result.skipped;
        allErrors.push(
          ...result.errors.map((e) => ({ selector: e.file, reason: e.reason })),
        );
      }

      // Apply i18n patches
      if (hasI18nPatches(input.patches)) {
        const result = applyI18nJsonPatches(projectDir, i18nPatches);
        totalApplied += result.applied;
        totalSkipped += result.skipped;
        allErrors.push(
          ...result.errors.map((e) => ({ selector: e.key, reason: e.reason })),
        );
      }

      // Apply HTML patches
      if (htmlPatches.length > 0) {
        if (
          !input.filePath.endsWith(".html") &&
          !input.filePath.endsWith(".htm")
        ) {
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
        allErrors.push(...result.errors.map((e) => ({ selector: e.selector, reason: e.reason })));
      }

      const noChanges = totalApplied === 0;

      if (!noChanges) {
        projectTouchReporter.touch(input.slug);
      }

      return {
        success: true,
        noChanges,
        applied: totalApplied,
        skipped: totalSkipped,
        errors: allErrors,
      };
    }),

  getVersions: publicProcedure.query(async () => ({
    versions: [
      {
        version: 0,
        status: "current",
        description: "Working copy",
      },
    ],
    totalVersions: 1,
  })),

  gitHasChanges: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ ctx }) => {
      try {
        const hasChanges = await ctx.workspace.hasChanges();
        return { hasChanges: hasChanges ?? false };
      } catch (err) {
        console.error("Error checking git status:", err);
        return { hasChanges: false };
      }
    }),

  gitHistory: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ ctx }) => {
      try {
        const [history, totalCommits] = await Promise.all([
          ctx.workspace.getHistory(),
          ctx.workspace.getCommitCount(),
        ]);
        return {
          commits: history ?? [],
          totalCommits,
        };
      } catch (err) {
        console.error("Error fetching git history:", err);
        return { commits: [], totalCommits: 0 };
      }
    }),

  gitSave: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        message: z.string().min(1, "Commit message is required"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const hash = await ctx.workspace.commit(input.message);
      if (!hash) {
        return {
          success: true,
          hash: "",
          noChanges: true,
          message: "No changes to save",
        };
      }

      projectTouchReporter.touch(input.slug);

      const projectDir = ctx.workspace.getProjectPath();
      const config = detectProjectType(projectDir);
      // Keep bucket-backed preview up to date (best-effort, async).
      if (config.framework === "astro") {
        void syncSourceToBucket({
          projectDir,
          slug: input.slug,
          version: input.version,
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Artifacts] Source sync failed: ${msg}`);
        });

        void buildAndUploadPreview({
          projectDir,
          slug: input.slug,
          version: input.version,
          commitHash: hash,
        })
          .then(() => {
            thumbnailGenerationReporter.request(input.slug, input.version);
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Artifacts] Preview build/upload failed: ${msg}`);
          });
      } else {
        void syncSourceToBucket({
          projectDir,
          slug: input.slug,
          version: input.version,
        })
          .then(() => {
            thumbnailGenerationReporter.request(input.slug, input.version);
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Artifacts] Source sync failed: ${msg}`);
          });
      }

      return {
        success: true,
        hash,
        noChanges: false,
        message: `Saved version with commit ${hash.substring(0, 7)}`,
      };
    }),

  gitDiscardChanges: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      await ctx.workspace.discardChanges();
      projectTouchReporter.touch(input.slug);

      return {
        success: true,
        message: "All changes discarded",
      };
    }),

  publishStatus: publicProcedure
    .input(
      z.object({
        slug: z.string(),
      })
    )
    .query(async ({ ctx }) => {
      try {
        const tags = await ctx.workspace.getTags?.();
        const lastTag = tags?.[0] || null;
        return {
          isPublished: tags && tags.length > 0,
          lastTag: lastTag,
          domain: null,
        };
      } catch (err) {
        console.error("Error fetching publish status:", err);
        return {
          isPublished: false,
          lastTag: null,
          domain: null,
        };
      }
    }),

  gitWorkingCommit: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ ctx }) => {
      try {
        const workingHash = await ctx.workspace.getWorkingCommit();
        if (workingHash) {
          return { hash: workingHash };
        }

        const head = await ctx.workspace.getHeadCommit();
        return { hash: head?.hash || null };
      } catch (err) {
        console.error("Error fetching head commit:", err);
        return {
          hash: null,
        };
      }
    }),

  gitLoadVersion: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        commitHash: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      await ctx.workspace.loadVersion(input.commitHash);
      projectTouchReporter.touch(input.slug);

      const shortHash = input.commitHash.substring(0, 7);
      return {
        success: true,
        message: `Loaded version ${shortHash}`,
      };
    }),

  setCurrentVersion: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async () => ({
      success: true,
    })),

  createTag: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        tagName: z.string(),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Create annotated git tag with optional message
        const git = simpleGit(ctx.workspace.getProjectPath());

        if (input.message) {
          await git.tag(["-a", input.tagName, "-m", input.message]);
        } else {
          await git.tag([input.tagName]);
        }

        const version = Math.max(
          1,
          Number.parseInt(process.env.VIVD_PROJECT_VERSION || "1", 10) || 1,
        );
        const commitHash = (await git.raw(["rev-parse", "HEAD"])).trim();
        const projectDir = ctx.workspace.getProjectPath();

        // Keep bucket-backed published artifacts up to date (best-effort, async).
        void syncSourceToBucket({
          projectDir,
          slug: input.slug,
          version,
        }).catch(() => {});
        void buildAndUploadPublished({
          projectDir,
          slug: input.slug,
          version,
          commitHash,
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Artifacts] Published build/upload failed: ${msg}`);
        });

        projectTouchReporter.touch(input.slug);

        return {
          success: true,
          tag: input.tagName,
          message: `Created tag: ${input.tagName}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        throw new Error(`Failed to create tag: ${msg}`);
      }
    }),
});
