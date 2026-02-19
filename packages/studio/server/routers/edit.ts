import { z } from "zod";
import fs from "fs-extra";
import path from "path";
import { router, publicProcedure } from "../trpc/trpc.js";
import { vivdPatchSchema } from "../../shared/types.js";
import {
  applyHtmlPatches,
  type HtmlPatch,
} from "../services/HtmlPatchService.js";
import {
  applyAstroPatches,
  hasAstroPatches,
  extractAstroPatches,
} from "../services/AstroPatchService.js";
import {
  applyI18nJsonPatches,
  hasI18nPatches,
  extractI18nPatches,
} from "../services/I18nJsonPatchService.js";
import { requestBucketSync } from "../services/AgentTaskSyncService.js";

export const editRouter = router({
  applyPatches: publicProcedure
    .input(
      z.object({
        file: z.string(),
        patches: z.array(vivdPatchSchema),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return {
          success: false,
          modifiedFiles: [],
          errors: ["Workspace not initialized"],
        };
      }

      const projectPath = ctx.workspace.getProjectPath();
      const filePath = path.join(projectPath, input.file);
      const modifiedFiles: string[] = [];
      const errors: string[] = [];

      // Separate patches by type
      const htmlPatches: HtmlPatch[] = [];
      const textPatches = input.patches.filter(
        (p) => p.type === "setTextNode"
      ) as HtmlPatch[];
      const astroPatches = extractAstroPatches(input.patches);

      // Add text patches to HTML patches
      htmlPatches.push(...textPatches);

      // Apply HTML patches if we have any and the file exists
      if (htmlPatches.length > 0 && fs.existsSync(filePath)) {
        try {
          const html = await fs.readFile(filePath, "utf-8");
          const result = applyHtmlPatches(html, htmlPatches);

          if (result.applied > 0) {
            await fs.writeFile(filePath, result.html, "utf-8");
            modifiedFiles.push(input.file);
          }

          if (result.errors.length > 0) {
            errors.push(
              ...result.errors.map((e) => `${e.selector}: ${e.reason}`)
            );
          }
        } catch (err) {
          errors.push(
            `Failed to apply HTML patches: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // Apply i18n patches to JSON locale files
      if (hasI18nPatches(input.patches)) {
        const i18nPatchList = extractI18nPatches(input.patches);
        const i18nResult = applyI18nJsonPatches(projectPath, i18nPatchList);

        if (i18nResult.applied > 0) {
          // Track which locale files were modified
          const langs = [...new Set(i18nPatchList.map((p) => p.lang))];
          for (const lang of langs) {
            modifiedFiles.push(`locales/${lang}.json`);
          }
        }

        if (i18nResult.errors.length > 0) {
          errors.push(
            ...i18nResult.errors.map((e) => `i18n:${e.key}: ${e.reason}`)
          );
        }
      }

      // Apply Astro patches
      if (hasAstroPatches(input.patches)) {
        const astroResult = applyAstroPatches(projectPath, astroPatches);

        if (astroResult.applied > 0) {
          const files = [...new Set(astroPatches.map((p) => p.sourceFile))];
          modifiedFiles.push(...files);
        }

        if (astroResult.errors.length > 0) {
          errors.push(
            ...astroResult.errors.map((e) => `${e.file}: ${e.reason}`)
          );
        }
      }

      if (modifiedFiles.length > 0) {
        requestBucketSync("edit-router-patches", {
          file: input.file,
          modifiedFiles: [...new Set(modifiedFiles)],
        });
      }

      return {
        success: errors.length === 0,
        modifiedFiles: [...new Set(modifiedFiles)],
        errors,
      };
    }),

  // Apply patches to a specific HTML file
  applyHtmlPatches: publicProcedure
    .input(
      z.object({
        file: z.string(),
        patches: z.array(
          z.discriminatedUnion("type", [
            z.object({
              type: z.literal("setTextNode"),
              selector: z.string(),
              index: z.number(),
              value: z.string(),
            }),
            z.object({
              type: z.literal("setAttr"),
              selector: z.string(),
              name: z.string(),
              value: z.string(),
            }),
            z.object({
              type: z.literal("setI18n"),
              key: z.string(),
              lang: z.string(),
              value: z.string(),
            }),
          ])
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return {
          success: false,
          applied: 0,
          skipped: 0,
          errors: [{ selector: "*", reason: "Workspace not initialized" }],
        };
      }

      const projectPath = ctx.workspace.getProjectPath();
      const filePath = path.join(projectPath, input.file);

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          applied: 0,
          skipped: 0,
          errors: [{ selector: "*", reason: "File not found" }],
        };
      }

      try {
        const html = await fs.readFile(filePath, "utf-8");
        const result = applyHtmlPatches(html, input.patches);

        if (result.applied > 0) {
          await fs.writeFile(filePath, result.html, "utf-8");
          requestBucketSync("edit-router-html-patches", {
            file: input.file,
            applied: result.applied,
          });
        }

        return {
          success: result.errors.length === 0,
          applied: result.applied,
          skipped: result.skipped,
          errors: result.errors,
        };
      } catch (err) {
        return {
          success: false,
          applied: 0,
          skipped: 0,
          errors: [
            {
              selector: "*",
              reason: err instanceof Error ? err.message : String(err),
            },
          ],
        };
      }
    }),
});
