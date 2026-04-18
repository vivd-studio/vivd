import { z } from "zod";
import { studioOrgProcedure } from "../../trpc";
import { emailTemplateBrandingService } from "../../services/email/templateBranding";
import { limitsService } from "../../services/usage/LimitsService";
import { usageService, type TokenData } from "../../services/usage/UsageService";
import {
  studioImageGenerationReportSchema,
  studioUsageReportSchema,
} from "./schemas";

export const studioApiUsageSessionProcedures = {
  reportUsage: studioOrgProcedure
    .input(
      z.object({
        studioId: z.string(),
        reports: z.array(studioUsageReportSchema),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const actorId = ctx.session?.user.id ?? `studio:${input.studioId}`;

      console.log(
        `[StudioAPI] Received ${input.reports.length} usage reports from studio ${input.studioId} (user: ${actorId})`,
      );

      for (const report of input.reports) {
        await usageService.recordAiCost(
          organizationId,
          report.cost,
          report.tokens as TokenData | undefined,
          report.sessionId,
          report.sessionTitle,
          report.projectPath,
          report.partId,
        );
      }

      return { success: true, recorded: input.reports.length };
    }),

  reportImageGeneration: studioOrgProcedure
    .input(
      z.object({
        studioId: z.string(),
        report: studioImageGenerationReportSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const actorId = ctx.session?.user.id ?? `studio:${input.studioId}`;

      await usageService.recordImageGeneration(
        organizationId,
        input.report.projectPath,
        input.report.idempotencyKey,
      );

      console.log(
        `[StudioAPI] Received image generation report from studio ${input.studioId} (user: ${actorId})`,
      );

      return { success: true };
    }),

  updateSessionTitle: studioOrgProcedure
    .input(
      z.object({
        studioId: z.string(),
        sessionId: z.string(),
        sessionTitle: z.string(),
        projectSlug: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const actorId = ctx.session?.user.id ?? `studio:${input.studioId}`;

      console.log(
        `[StudioAPI] Session title update from studio ${input.studioId} (user: ${actorId}): ${input.sessionId} -> "${input.sessionTitle}"`,
      );

      await usageService.updateSessionTitle(
        organizationId,
        input.sessionId,
        input.sessionTitle,
        input.projectSlug,
      );

      return { success: true };
    }),

  getStatus: studioOrgProcedure
    .input(
      z.object({
        studioId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const actorId = ctx.session?.user.id ?? `studio:${input.studioId}`;
      const status = await limitsService.checkLimits(organizationId);

      console.log(
        `[StudioAPI] Status request from studio ${input.studioId} (user: ${actorId}): blocked=${status.blocked}`,
      );

      return status;
    }),

  getSupportContact: studioOrgProcedure
    .input(
      z.object({
        studioId: z.string(),
      }),
    )
    .query(async () => {
      const branding = await emailTemplateBrandingService.getResolvedBranding();
      return {
        supportEmail: branding.supportEmail?.trim() || null,
      };
    }),
};
