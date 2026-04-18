import { z } from "zod";
import { studioProjectProcedure } from "../../trpc";
import { previewLogsService } from "../../services/project/PreviewLogsService";
import { previewScreenshotService } from "../../services/project/PreviewScreenshotService";
import { previewStatusService } from "../../services/project/PreviewStatusService";
import { studioWorkspaceStateService } from "../../services/project/StudioWorkspaceStateService";
import {
  previewLogsSchema,
  previewLogLevelSchema,
  previewScreenshotSchema,
  previewStatusSchema,
} from "./schemas";

export const studioApiPreviewWorkspaceProcedures = {
  capturePreviewScreenshot: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        path: z.string().optional(),
        width: z.number().int().positive().max(4096).optional(),
        height: z.number().int().positive().max(4096).optional(),
        scrollX: z.number().int().nonnegative().max(20000).optional(),
        scrollY: z.number().int().nonnegative().max(50000).optional(),
        waitMs: z.number().int().nonnegative().max(15000).optional(),
        format: z.enum(["png", "jpeg", "webp"]).optional(),
      }),
    )
    .output(previewScreenshotSchema)
    .mutation(async ({ ctx, input }) => {
      return previewScreenshotService.capture({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        version: input.version,
        path: input.path,
        width: input.width,
        height: input.height,
        scrollX: input.scrollX,
        scrollY: input.scrollY,
        waitMs: input.waitMs,
        format: input.format,
      });
    }),

  capturePreviewLogs: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        path: z.string().optional(),
        waitMs: z.number().int().nonnegative().max(15000).optional(),
        limit: z.number().int().positive().max(200).optional(),
        level: previewLogLevelSchema.optional(),
        contains: z.string().trim().max(200).optional(),
      }),
    )
    .output(previewLogsSchema)
    .mutation(async ({ ctx, input }) => {
      return previewLogsService.capture({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        version: input.version,
        path: input.path,
        waitMs: input.waitMs,
        limit: input.limit,
        level: input.level,
        contains: input.contains,
      });
    }),

  getPreviewStatus: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
      }),
    )
    .output(previewStatusSchema)
    .query(async ({ ctx, input }) => {
      return previewStatusService.getStatus({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        version: input.version,
      });
    }),

  reportWorkspaceState: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        hasUnsavedChanges: z.boolean(),
        headCommitHash: z.string().nullable().optional(),
        workingCommitHash: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      studioWorkspaceStateService.report({
        studioId: input.studioId,
        organizationId: ctx.organizationId!,
        slug: input.slug,
        version: input.version,
        hasUnsavedChanges: input.hasUnsavedChanges,
        headCommitHash: input.headCommitHash ?? null,
        workingCommitHash: input.workingCommitHash ?? null,
      });

      return { success: true };
    }),
};
