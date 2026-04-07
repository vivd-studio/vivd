/**
 * Studio API Router
 *
 * Handles communication between connected studio instances and the main backend.
 * Studio instances authenticate using either the user's session token or the
 * machine-scoped Studio runtime token.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, studioOrgProcedure, studioProjectProcedure } from "../trpc";
import { usageService, type TokenData } from "../services/usage/UsageService";
import { limitsService } from "../services/usage/LimitsService";
import { getVersionDir, touchProjectUpdatedAt } from "../generator/versionUtils";
import {
  readInitialGenerationManifest,
  writeInitialGenerationManifest,
} from "../generator/initialGeneration";
import { thumbnailService } from "../services/project/ThumbnailService";
import { projectMetaService } from "../services/project/ProjectMetaService";
import { studioWorkspaceStateService } from "../services/project/StudioWorkspaceStateService";
import { studioAgentLeaseService } from "../services/project/StudioAgentLeaseService";
import { agentInstructionsService } from "../services/agent/AgentInstructionsService";
import {
  artifactBuildRequestService,
  isArtifactBuilderEnabled,
} from "../services/project/ArtifactBuildRequestService";
import {
  projectPluginService,
} from "../services/plugins/ProjectPluginService";
import { studioMachineProvider } from "../services/studioMachines";
import { contactFormPluginConfigSchema } from "../services/plugins/contactForm/config";
import { PLUGIN_IDS } from "../services/plugins/registry";
import type { ChecklistItem, ChecklistStatus } from "../types/checklistTypes";
import {
  extractRequestHost,
  getProjectPluginInfo,
  runProjectPluginAction,
  updateProjectPluginConfig,
} from "./plugins/operations";

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

function normalizeChecklistItemNote(note: string | null | undefined): string | undefined {
  if (note == null) return undefined;
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function summarizeChecklistItems(items: ChecklistItem[]): {
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  fixed?: number;
} {
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let skipped = 0;
  let fixed = 0;

  for (const item of items) {
    switch (item.status) {
      case "pass":
        passed += 1;
        break;
      case "fail":
        failed += 1;
        break;
      case "warning":
        warnings += 1;
        break;
      case "skip":
        skipped += 1;
        break;
      case "fixed":
        fixed += 1;
        break;
      default:
        break;
    }
  }

  return fixed > 0
    ? { passed, failed, warnings, skipped, fixed }
    : { passed, failed, warnings, skipped };
}

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

const projectInfoInputSchema = z.object({
  studioId: z.string(),
  slug: z.string().min(1),
  version: z.number().int().positive().optional(),
});
const pluginIdSchema = z.enum(PLUGIN_IDS);

function toLegacyContactPluginInfoResponse(
  info: Awaited<ReturnType<typeof getProjectPluginInfo>>,
) {
  const recipients =
    info.details &&
    typeof info.details === "object" &&
    "recipients" in info.details
      ? info.details.recipients
      : { options: [], pending: [] };

  return {
    pluginId: "contact_form" as const,
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    config: info.config,
    usage: info.usage,
    recipients,
    instructions: info.instructions,
  };
}

function toLegacyAnalyticsPluginInfoResponse(
  info: Awaited<ReturnType<typeof getProjectPluginInfo>>,
) {
  return {
    pluginId: "analytics" as const,
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    usage: info.usage,
    instructions: info.instructions,
  };
}

function toLegacyUpdatedPluginPayload(
  info: Awaited<ReturnType<typeof getProjectPluginInfo>>,
) {
  return {
    pluginId: info.pluginId,
    instanceId: info.instanceId ?? "",
    status: info.status ?? (info.enabled ? "enabled" : "disabled"),
    created: false,
    publicToken: info.publicToken ?? "",
    config: info.config ?? {},
    snippets: info.snippets ?? {},
  };
}

async function buildProjectInfo(options: {
  organizationId: string;
  slug: string;
  version?: number;
}) {
  const project = await projectMetaService.getProject(options.organizationId, options.slug);
  if (!project) {
    throw new Error(`Project not found: ${options.slug}`);
  }

  const resolvedVersion = options.version ?? Math.max(1, project.currentVersion || 1);
  const versionMeta = await projectMetaService.getProjectVersion(
    options.organizationId,
    options.slug,
    resolvedVersion,
  );

  if (!versionMeta && options.version) {
    throw new Error(`Project version not found: ${options.slug}/v${resolvedVersion}`);
  }

  const enabledPluginIds = await getEnabledProjectPluginIds(
    options.organizationId,
    options.slug,
  );

  return {
    project: {
      slug: options.slug,
      title: versionMeta?.title || project.title || options.slug,
      source: normalizeGenerationSource(versionMeta?.source ?? project.source),
      currentVersion: Math.max(1, project.currentVersion || resolvedVersion),
      requestedVersion: resolvedVersion,
    },
    enabledPluginIds,
  };
}

export const studioApiRouter = router({
  /**
   * Receive usage reports from studio instances.
   * Called by studio's UsageReporter service to sync usage data.
   * Authenticated via session token or studio runtime token.
   */
  reportUsage: studioOrgProcedure
    .input(
      z.object({
        studioId: z.string(),
        reports: z.array(studioUsageReportSchema),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const actorId = ctx.session?.user.id ?? `studio:${input.studioId}`;

      console.log(
        `[StudioAPI] Received ${input.reports.length} usage reports from studio ${input.studioId} (user: ${actorId})`
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

  /**
   * Update the display title for an OpenCode session after it has been renamed.
   * This allows the usage table to reflect the latest session titles even if no
   * further usage events are emitted after the rename.
   */
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

  /**
   * Return current usage status for a studio instance.
   * Studio calls this to get limit information for display.
   * Authenticated via session token or studio runtime token.
   */
  getStatus: studioOrgProcedure
    .input(
      z.object({
        studioId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const actorId = ctx.session?.user.id ?? `studio:${input.studioId}`;

      // Return current limit status
      const status = await limitsService.checkLimits(organizationId);

      console.log(
        `[StudioAPI] Status request from studio ${input.studioId} (user: ${actorId}): blocked=${status.blocked}`
      );

      return status;
    }),

  getProjectInfo: studioProjectProcedure
    .input(projectInfoInputSchema)
    .query(async ({ ctx, input }) => {
      return buildProjectInfo({
        organizationId: ctx.organizationId!,
        slug: input.slug,
        version: input.version,
      });
    }),

  /**
   * Return rendered agent instructions for the active project/version.
   * Studio consumes this at session start and injects it as OpenCode `system`.
   */
  getAgentInstructions: studioProjectProcedure
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

  getProjectContactPluginInfo: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const info = await getProjectPluginInfo({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        pluginId: "contact_form",
      });
      return toLegacyContactPluginInfoResponse(info);
    }),

  getProjectAnalyticsPluginInfo: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const info = await getProjectPluginInfo({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        pluginId: "analytics",
      });
      return toLegacyAnalyticsPluginInfoResponse(info);
    }),

  updateProjectContactPluginConfig: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        config: contactFormPluginConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const info = await updateProjectPluginConfig({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        pluginId: "contact_form",
        config: input.config,
      });
      return toLegacyUpdatedPluginPayload(info);
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

  requestProjectContactRecipientVerification: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        email: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await runProjectPluginAction({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        pluginId: "contact_form",
        actionId: "verify_recipient",
        args: [input.email],
        requestedByUserId: ctx.session?.user.id ?? null,
        requestHost:
          ctx.requestHost ??
          extractRequestHost(ctx.req.headers["x-forwarded-host"]) ??
          extractRequestHost(ctx.req.headers.host),
      });
      return result.result;
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

  /**
   * Mark a project's metadata as updated.
   * Studio instances call this after local workspace edits/snapshots so the main app
   * can sort projects by last activity.
   */
  touchProjectUpdatedAt: studioProjectProcedure
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
  updateInitialGenerationStatus: studioProjectProcedure
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
        sessionId: z.string().trim().min(1).max(255).optional(),
        errorMessage: z.string().trim().min(1).max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const versionDir = getVersionDir(
        ctx.organizationId!,
        input.slug,
        input.version,
      );
      const manifest = readInitialGenerationManifest(versionDir);
      if (manifest?.mode === "studio_astro") {
        const nextSessionId = input.sessionId ?? manifest.sessionId ?? null;
        const now = new Date().toISOString();
        writeInitialGenerationManifest(versionDir, {
          ...manifest,
          state: input.status,
          sessionId: nextSessionId,
          startedAt:
            input.status === "generating_initial_site"
              ? manifest.startedAt ?? now
              : manifest.startedAt ?? (nextSessionId ? now : null),
          completedAt:
            input.status === "completed" || input.status === "failed"
              ? now
              : null,
          errorMessage:
            input.status === "failed"
              ? input.errorMessage ?? manifest.errorMessage ?? "Initial generation failed."
              : null,
        });
      }

      await projectMetaService.updateVersionStatus({
        organizationId: ctx.organizationId!,
        slug: input.slug,
        version: input.version,
        status: input.status,
        errorMessage: input.status === "failed" ? input.errorMessage : undefined,
      });
      return { success: true };
    }),

  requestArtifactBuild: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        kind: z.enum(["preview", "published"]),
        commitHash: z.string().trim().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isArtifactBuilderEnabled()) {
        return {
          enabled: false,
          accepted: false,
          deduped: false,
          status: "disabled" as const,
        };
      }

      const result =
        input.kind === "published"
          ? await artifactBuildRequestService.requestPublishedBuild({
              organizationId: ctx.organizationId!,
              slug: input.slug,
              version: input.version,
              commitHash: input.commitHash,
            })
          : await artifactBuildRequestService.requestPreviewBuild({
              organizationId: ctx.organizationId!,
              slug: input.slug,
              version: input.version,
              commitHash: input.commitHash,
            });

      return {
        enabled: true,
        ...result,
      };
    }),

  /**
   * Request thumbnail regeneration for a project version.
   * Studio instances call this after snapshot/build artifacts have been synced so
   * the control plane can refresh project card thumbnails from the bucket-backed preview.
   */
  generateThumbnail: studioProjectProcedure
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

  /**
   * Receive agent task lease heartbeats from connected studio runtimes.
   * Keeps machines alive while an agent run is active, but applies a hard cap.
   */
  reportAgentTaskLease: studioProjectProcedure
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
  upsertPublishChecklist: studioProjectProcedure
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
  getPublishChecklist: studioProjectProcedure
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

  updatePublishChecklistItem: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        itemId: z.string().min(1),
        status: z.enum(["pass", "fail", "warning", "skip", "fixed"]),
        note: z.string().max(4_000).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const existing = await projectMetaService.getPublishChecklist({
        organizationId,
        slug: input.slug,
        version: input.version,
      });

      if (!existing) {
        throw new Error(
          "No publish checklist exists for this project version. Run the checklist first.",
        );
      }

      const itemIndex = existing.items.findIndex((item) => item.id === input.itemId);
      if (itemIndex < 0) {
        throw new Error(
          `Unknown checklist item "${input.itemId}" for this project version.`,
        );
      }

      const note = normalizeChecklistItemNote(input.note);
      const updatedItems = existing.items.map((item, index) => {
        if (index !== itemIndex) return item;
        return {
          ...item,
          status: input.status as ChecklistStatus,
          note,
        };
      });
      const summary = summarizeChecklistItems(updatedItems);
      const checklist = {
        ...existing,
        projectSlug: input.slug,
        version: input.version,
        runAt: new Date().toISOString(),
        items: updatedItems,
        summary,
      };

      await projectMetaService.upsertPublishChecklist({
        organizationId,
        checklist,
      });

      return {
        checklist,
        item: checklist.items[itemIndex],
      };
    }),
});
