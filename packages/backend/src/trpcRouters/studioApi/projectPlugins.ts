import { z } from "zod";
import { studioProjectProcedure } from "../../trpc";
import { agentInstructionsService } from "../../services/agent/AgentInstructionsService";
import {
  getVersionDir,
  touchProjectUpdatedAt as markProjectUpdatedAt,
} from "../../generator/versionUtils";
import { thumbnailService } from "../../services/project/ThumbnailService";
import { setProjectVersionStatus } from "../../services/project/ProjectStatusService";
import { projectPluginService } from "../../services/plugins/ProjectPluginService";
import {
  extractRequestHost,
  getProjectPluginInfo,
  readProjectPluginData,
  runProjectPluginAction,
  updateProjectPluginConfig,
} from "../plugins/operations";
import { buildProjectInfo, resolveStudioProjectVersion } from "./shared";
import { pluginIdSchema, projectInfoInputSchema } from "./schemas";

export const studioApiProjectPluginProcedures = {
  getProjectInfo: studioProjectProcedure
    .input(projectInfoInputSchema)
    .query(async ({ ctx, input }) => {
      return buildProjectInfo({
        organizationId: ctx.organizationId!,
        slug: input.slug,
        version: input.version,
      });
    }),

  getAgentInstructions: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const resolved = await resolveStudioProjectVersion({
        organizationId: ctx.organizationId!,
        slug: input.slug,
        version: input.version,
      });

      const projectName =
        resolved.versionMeta?.title?.trim() ||
        resolved.project.title?.trim() ||
        input.slug;
      const rendered = await agentInstructionsService.render({
        projectName,
        source: resolved.source,
        enabledPlugins: resolved.enabledPluginIds,
      });

      return {
        slug: input.slug,
        version: resolved.resolvedVersion,
        source: resolved.source,
        projectName,
        enabledPluginIds: resolved.enabledPluginIds,
        instructions: rendered.instructions,
        instructionsHash: rendered.instructionsHash,
        templateSource: rendered.templateSource,
      };
    }),

  getProjectPluginsCatalog: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return projectPluginService.listCatalogForProject(
        ctx.organizationId!,
        input.slug,
      );
    }),

  getProjectPluginInfo: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        pluginId: pluginIdSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      return getProjectPluginInfo({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        pluginId: input.pluginId,
      });
    }),

  getProjectPluginRead: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        pluginId: pluginIdSchema,
        readId: z.string().trim().min(1),
        input: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .query(async ({ ctx, input }) => {
      return readProjectPluginData({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        pluginId: input.pluginId,
        readId: input.readId,
        input: input.input,
      });
    }),

  updateProjectPluginConfig: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        pluginId: pluginIdSchema,
        config: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return updateProjectPluginConfig({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        pluginId: input.pluginId,
        config: input.config,
      });
    }),

  runProjectPluginAction: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        pluginId: pluginIdSchema,
        actionId: z.string().trim().min(1),
        args: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return runProjectPluginAction({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        pluginId: input.pluginId,
        actionId: input.actionId,
        args: input.args,
        requestedByUserId: ctx.session?.user.id ?? null,
        requestHost:
          ctx.requestHost ??
          extractRequestHost(ctx.req.headers["x-forwarded-host"]) ??
          extractRequestHost(ctx.req.headers.host),
      });
    }),

  touchProjectUpdatedAt: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await markProjectUpdatedAt(ctx.organizationId!, input.slug);
      return { success: true };
    }),

  updateInitialGenerationStatus: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        status: z.enum([
          "generating_initial_site",
          "initial_generation_paused",
          "completed",
          "failed",
        ]),
        sessionId: z.string().trim().min(1).max(255).optional(),
        errorMessage: z.string().trim().min(1).max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setProjectVersionStatus({
        organizationId: ctx.organizationId!,
        slug: input.slug,
        version: input.version,
        status: input.status,
        sessionId: input.sessionId,
        errorMessage:
          input.status === "failed" || input.status === "initial_generation_paused"
            ? input.errorMessage
            : undefined,
      });
      return { success: true };
    }),

  generateThumbnail: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      void markProjectUpdatedAt(ctx.organizationId!, input.slug).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[StudioAPI] touchProjectUpdatedAt failed for ${input.slug}: ${message}`,
        );
      });

      const versionDir = getVersionDir(ctx.organizationId!, input.slug, input.version);
      thumbnailService
        .generateThumbnail(versionDir, ctx.organizationId!, input.slug, input.version)
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[StudioAPI] Thumbnail generation failed for ${input.slug}/v${input.version}: ${message}`,
          );
        });

      return { success: true };
    }),
};
