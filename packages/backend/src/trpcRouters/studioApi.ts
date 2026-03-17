/**
 * Studio API Router
 *
 * Handles communication between connected studio instances and the main backend.
 * Studio instances authenticate using the user's session token (same as other protected routes).
 */

import { z } from "zod";
import { router, orgProcedure, projectMemberProcedure } from "../trpc";
import { usageService, type TokenData } from "../services/usage/UsageService";
import { limitsService } from "../services/usage/LimitsService";
import { getVersionDir, touchProjectUpdatedAt } from "../generator/versionUtils";
import { thumbnailService } from "../services/project/ThumbnailService";
import { projectMetaService } from "../services/project/ProjectMetaService";
import { studioWorkspaceStateService } from "../services/project/StudioWorkspaceStateService";
import { studioAgentLeaseService } from "../services/project/StudioAgentLeaseService";
import { agentInstructionsService } from "../services/agent/AgentInstructionsService";
import { projectPluginService } from "../services/plugins/ProjectPluginService";
import { studioMachineProvider } from "../services/studioMachines";

/**
 * Schema for token data in usage reports
 */
const tokenDataSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: z.object({
    read: z.number(),
    write: z.number(),
  }),
});

/**
 * Schema for individual usage report from studio
 */
const studioUsageReportSchema = z.object({
  sessionId: z.string(),
  sessionTitle: z.string().optional(),
  cost: z.number(),
  tokens: tokenDataSchema.optional(),
  partId: z.string().optional(),
  projectPath: z.string().optional(),
  timestamp: z.string(),
});

const studioImageGenerationReportSchema = z.object({
  projectPath: z.string().optional(),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
  timestamp: z.string(),
});

const checklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "fail", "warning", "skip", "fixed"]),
  note: z.string().optional(),
});

const prePublishChecklistSchema = z.object({
  projectSlug: z.string(),
  version: z.number().int().positive(),
  runAt: z.string(),
  snapshotCommitHash: z.string().optional(),
  items: z.array(checklistItemSchema),
  summary: z.object({
    passed: z.number(),
    failed: z.number(),
    warnings: z.number(),
    skipped: z.number(),
    fixed: z.number().optional(),
  }),
});

function normalizeGenerationSource(source: string | null | undefined): "url" | "scratch" {
  return source === "url" ? "url" : "scratch";
}

async function getEnabledProjectPluginIds(
  organizationId: string,
  slug: string,
): Promise<string[]> {
  const catalog = await projectPluginService.listCatalogForProject(
    organizationId,
    slug,
  );
  return catalog.instances
    .filter((instance) => instance.status === "enabled")
    .map((instance) => instance.pluginId)
    .sort();
}

export const studioApiRouter = router({
  /**
   * Receive usage reports from studio instances.
   * Called by studio's UsageReporter service to sync usage data.
   * Authenticated via user's session token.
   */
  reportUsage: orgProcedure
    .input(
      z.object({
        studioId: z.string(),
        reports: z.array(studioUsageReportSchema),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const userId = ctx.session.user.id;

      console.log(
        `[StudioAPI] Received ${input.reports.length} usage reports from studio ${input.studioId} (user: ${userId})`
      );

      // Record each report via UsageService
      for (const report of input.reports) {
        await usageService.recordAiCost(
          organizationId,
          report.cost,
          report.tokens as TokenData | undefined,
          report.sessionId,
          report.sessionTitle,
          report.projectPath, // Use projectPath as projectSlug for studio reports
          report.partId
        );
      }

      return { success: true, recorded: input.reports.length };
    }),

  /**
   * Receive image-generation usage reports from studio tools.
   * Called when image generation succeeds in connected studio mode.
   */
  reportImageGeneration: orgProcedure
    .input(
      z.object({
        studioId: z.string(),
        report: studioImageGenerationReportSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const userId = ctx.session.user.id;

      await usageService.recordImageGeneration(
        organizationId,
        input.report.projectPath,
        input.report.idempotencyKey,
      );

      console.log(
        `[StudioAPI] Received image generation report from studio ${input.studioId} (user: ${userId})`,
      );

      return { success: true };
    }),

  /**
   * Update the display title for an OpenCode session after it has been renamed.
   * This allows the usage table to reflect the latest session titles even if no
   * further usage events are emitted after the rename.
   */
  updateSessionTitle: orgProcedure
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
      const userId = ctx.session.user.id;

      console.log(
        `[StudioAPI] Session title update from studio ${input.studioId} (user: ${userId}): ${input.sessionId} -> "${input.sessionTitle}"`,
      );

      await usageService.updateSessionTitle(
        organizationId,
        input.sessionId,
        input.sessionTitle,
        input.projectSlug,
      );

      return { success: true };
    }),

  /**
   * Return current usage status for a studio instance.
   * Studio calls this to get limit information for display.
   * Authenticated via user's session token.
   */
  getStatus: orgProcedure
    .input(
      z.object({
        studioId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const userId = ctx.session.user.id;

      // Return current limit status
      const status = await limitsService.checkLimits(organizationId);

      console.log(
        `[StudioAPI] Status request from studio ${input.studioId} (user: ${userId}): blocked=${status.blocked}`
      );

      return status;
    }),

  /**
   * Return rendered agent instructions for the active project/version.
   * Studio consumes this at session start and injects it as OpenCode `system`.
   */
  getAgentInstructions: projectMemberProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const project = await projectMetaService.getProject(organizationId, input.slug);
      if (!project) {
        throw new Error(`Project not found: ${input.slug}`);
      }

      const resolvedVersion = input.version ?? Math.max(1, project.currentVersion || 1);
      const versionMeta = await projectMetaService.getProjectVersion(
        organizationId,
        input.slug,
        resolvedVersion,
      );

      if (!versionMeta && input.version) {
        throw new Error(
          `Project version not found: ${input.slug}/v${resolvedVersion}`,
        );
      }

      const projectName =
        versionMeta?.title?.trim() || project.title?.trim() || input.slug;
      const source = normalizeGenerationSource(versionMeta?.source ?? project.source);
      const enabledPluginIds = await getEnabledProjectPluginIds(
        organizationId,
        input.slug,
      );
      const rendered = await agentInstructionsService.render({
        projectName,
        source,
        enabledPlugins: enabledPluginIds,
      });

      return {
        slug: input.slug,
        version: resolvedVersion,
        source,
        projectName,
        enabledPluginIds,
        instructions: rendered.instructions,
        instructionsHash: rendered.instructionsHash,
        templateSource: rendered.templateSource,
      };
    }),

  /**
   * Mark a project's metadata as updated.
   * Studio instances call this after local workspace edits/snapshots so the main app
   * can sort projects by last activity.
   */
  touchProjectUpdatedAt: projectMemberProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await touchProjectUpdatedAt(ctx.organizationId!, input.slug);
      return { success: true };
    }),

  /**
   * Allow connected Studio runtimes to update the initial scratch-generation status
   * as the OpenCode session progresses.
   */
  updateInitialGenerationStatus: projectMemberProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        status: z.enum([
          "generating_initial_site",
          "completed",
          "failed",
        ]),
        errorMessage: z.string().trim().min(1).max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await projectMetaService.updateVersionStatus({
        organizationId: ctx.organizationId!,
        slug: input.slug,
        version: input.version,
        status: input.status,
        errorMessage: input.status === "failed" ? input.errorMessage : undefined,
      });
      return { success: true };
    }),

  /**
   * Request thumbnail regeneration for a project version.
   * Studio instances call this after snapshot/build artifacts have been synced so
   * the control plane can refresh project card thumbnails from the bucket-backed preview.
   */
  generateThumbnail: projectMemberProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Also touch project activity so list sorting updates immediately.
      void touchProjectUpdatedAt(ctx.organizationId!, input.slug).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[StudioAPI] touchProjectUpdatedAt failed for ${input.slug}: ${message}`,
        );
      });

      // Fire-and-forget; thumbnail generation is debounced internally.
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

  /**
   * Receive live workspace state from connected studio.
   * Used by publish safety checks to avoid publishing while Studio has unsaved edits.
   */
  reportWorkspaceState: projectMemberProcedure
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

  /**
   * Receive agent task lease heartbeats from connected studio runtimes.
   * Keeps machines alive while an agent run is active, but applies a hard cap.
   */
  reportAgentTaskLease: projectMemberProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        sessionId: z.string().min(1),
        runId: z.string().min(1),
        state: z.enum(["active", "idle"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;

      if (input.state === "idle") {
        studioAgentLeaseService.reportIdle({
          organizationId,
          slug: input.slug,
          version: input.version,
          runId: input.runId,
        });
        return {
          success: true,
          keepalive: false,
          leaseState: "idle" as const,
        };
      }

      const lease = studioAgentLeaseService.reportActive({
        organizationId,
        slug: input.slug,
        version: input.version,
        studioId: input.studioId,
        sessionId: input.sessionId,
        runId: input.runId,
      });

      if (lease.leaseState === "active") {
        try {
          await studioMachineProvider.touch(
            organizationId,
            input.slug,
            input.version,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[StudioAPI] Failed to touch machine for active agent lease ${organizationId}:${input.slug}/v${input.version}: ${message}`,
          );
        }
      } else {
        console.warn(
          `[StudioAPI] Agent lease max exceeded for ${organizationId}:${input.slug}/v${input.version} session=${input.sessionId} run=${input.runId} ageMs=${lease.ageMs}`,
        );
      }

      return {
        success: true,
        keepalive: lease.leaseState === "active",
        leaseState: lease.leaseState,
      };
    }),

  /**
   * Upsert checklist state from connected studio into DB.
   */
  upsertPublishChecklist: projectMemberProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        checklist: prePublishChecklistSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await projectMetaService.upsertPublishChecklist({
        organizationId: ctx.organizationId!,
        checklist: {
          ...input.checklist,
          projectSlug: input.slug,
          version: input.version,
        },
      });
      return { success: true };
    }),

  /**
   * Read checklist state for connected studio from DB.
   */
  getPublishChecklist: projectMemberProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const checklist = await projectMetaService.getPublishChecklist({
        organizationId: ctx.organizationId!,
        slug: input.slug,
        version: input.version,
      });
      return { checklist };
    }),
});
