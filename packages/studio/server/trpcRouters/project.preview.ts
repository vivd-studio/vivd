import path from "path";
import fs from "fs";
import { z } from "zod";
import { publicProcedure } from "../trpc/trpc.js";
import {
  applyHtmlPatches,
  type HtmlPatch,
} from "../services/patching/HtmlPatchService.js";
import {
  applyAstroPatches,
  hasAstroPatches,
  type AstroPatch,
} from "../services/patching/AstroPatchService.js";
import {
  applyI18nJsonPatches,
  extractI18nPatches,
  hasI18nPatches,
  type I18nJsonPatch,
} from "../services/patching/I18nJsonPatchService.js";
import { devServerService } from "../services/project/DevServerService.js";
import { detectProjectType } from "../services/project/projectType.js";
import { syncSourceToBucket } from "../services/sync/ArtifactSyncService.js";
import { projectTouchReporter } from "../services/reporting/ProjectTouchReporter.js";
import { thumbnailGenerationReporter } from "../services/reporting/ThumbnailGenerationReporter.js";
import { requestBucketSync } from "../services/sync/AgentTaskSyncService.js";
import { isConnectedMode } from "@vivd/shared";
import {
  callConnectedBackendQuery,
  hasDotSegment,
} from "./project.shared.js";

const htmlPatchInput = z.discriminatedUnion("type", [
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
  z.object({
    type: z.literal("setAstroImage"),
    sourceFile: z.string().min(1),
    sourceLoc: z.string().optional(),
    assetPath: z.string().min(1),
    oldValue: z.string().optional(),
  }),
]);

export const previewProjectProcedures = {
  getPreviewInfo: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return {
          mode: "static" as const,
          status: "starting" as const,
          url: "/",
          error: "Workspace not initialized",
        };
      }

      const projectDir = ctx.workspace.getProjectPath();
      const config = detectProjectType(projectDir);

      if (config.mode === "static") {
        return {
          mode: "static" as const,
          status: "ready" as const,
          url: "/",
        };
      }

      const result = await devServerService.getOrStartDevServer(projectDir, "/");

      return {
        mode: "devserver" as const,
        status: result.status,
        url: "/",
        error: result.error,
      };
    }),

  getShareablePreviewUrl: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        origin: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (isConnectedMode()) {
        const status = await callConnectedBackendQuery<{
          canonicalUrl?: string;
        }>(ctx, "project.getExternalPreviewStatus", {
          slug: input.slug,
          version: input.version,
        });

        const url = status.canonicalUrl;
        if (typeof url === "string" && url.length > 0) return { url };
      }

      const shareablePath = `/vivd-studio/api/preview/${input.slug}/v${input.version}/`;
      const origin = (() => {
        const candidate = input.origin?.trim();
        if (!candidate) return null;
        try {
          return new URL(candidate).origin;
        } catch {
          return null;
        }
      })();

      if (!origin) {
        return { url: shareablePath };
      }

      return { url: new URL(shareablePath, origin).toString() };
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
    .mutation(async ({ ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return { success: false };
      }

      await devServerService.stopDevServer({ reason: "api-stop" });
      return { success: true };
    }),

  restartDevServer: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        clean: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace.isInitialized()) {
        return {
          success: false,
          status: "error" as const,
          error: "Workspace not initialized",
        };
      }

      const projectDir = ctx.workspace.getProjectPath();
      const result = await devServerService.restartDevServer(projectDir, "/", {
        clean: input.clean,
        resetCaches: true,
      });

      return { success: true, status: result.status, error: result.error };
    }),

  applyHtmlPatches: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        filePath: z.string().default("index.html"),
        patches: z.array(htmlPatchInput).min(1, "At least one patch is required"),
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
      const astroPatches: AstroPatch[] = [];
      const htmlPatches: HtmlPatch[] = [];

      for (const patch of input.patches) {
        if (patch.type === "setAstroText") {
          astroPatches.push({
            type: "setAstroText",
            sourceFile: patch.sourceFile,
            sourceLoc: patch.sourceLoc,
            oldValue: patch.oldValue,
            newValue: patch.newValue,
          });
          continue;
        }

        if (patch.type === "setAstroImage") {
          astroPatches.push({
            type: "setAstroImage",
            sourceFile: patch.sourceFile,
            sourceLoc: patch.sourceLoc,
            assetPath: patch.assetPath,
            oldValue: patch.oldValue,
          });
          continue;
        }

        if (patch.type === "setTextNode") {
          htmlPatches.push({
            type: "setTextNode",
            selector: patch.selector,
            index: patch.index,
            value: patch.value,
          });
          continue;
        }

        if (patch.type === "setAttr") {
          htmlPatches.push({
            type: "setAttr",
            selector: patch.selector,
            name: patch.name,
            value: patch.value,
          });
        }
      }

      const i18nPatches = extractI18nPatches(input.patches).map(
        (patch): I18nJsonPatch => ({
          key: patch.key,
          lang: patch.lang,
          value: patch.value,
        }),
      );

      let totalApplied = 0;
      let totalSkipped = 0;
      const allErrors: Array<{ selector: string; reason: string }> = [];

      if (hasAstroPatches(input.patches)) {
        const result = applyAstroPatches(projectDir, astroPatches);
        totalApplied += result.applied;
        totalSkipped += result.skipped;
        allErrors.push(
          ...result.errors.map((error) => ({
            selector: error.file,
            reason: error.reason,
          })),
        );
      }

      if (hasI18nPatches(input.patches)) {
        const result = applyI18nJsonPatches(projectDir, i18nPatches);
        totalApplied += result.applied;
        totalSkipped += result.skipped;
        allErrors.push(
          ...result.errors.map((error) => ({
            selector: error.key,
            reason: error.reason,
          })),
        );
      }

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
        allErrors.push(
          ...result.errors.map((error) => ({
            selector: error.selector,
            reason: error.reason,
          })),
        );
      }

      const noChanges = totalApplied === 0;

      if (!noChanges) {
        projectTouchReporter.touch(input.slug);
        requestBucketSync("project-html-patches", {
          slug: input.slug,
          version: input.version,
          filePath: input.filePath,
          applied: totalApplied,
        });

        void ctx.workspace
          .getHeadCommit()
          .then((head) =>
            syncSourceToBucket({
              projectDir,
              slug: input.slug,
              version: input.version,
              commitHash: head?.hash,
            }),
          )
          .then(() => {
            thumbnailGenerationReporter.request(input.slug, input.version);
          })
          .catch((error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            console.warn(`[Artifacts] Source sync failed: ${message}`);
          });
      }

      return {
        success: true,
        noChanges,
        applied: totalApplied,
        skipped: totalSkipped,
        errors: allErrors,
      };
    }),
};
