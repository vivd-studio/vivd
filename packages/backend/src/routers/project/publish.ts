import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { projectMemberProcedure } from "../../trpc";
import {
  publishService,
  PublishConflictError,
} from "../../services/publish/PublishService";
import { resolvePublishableArtifactState } from "../../services/project/ProjectArtifactStateService";
import { studioMachineProvider } from "../../services/studioMachines";
import { projectMetaService } from "../../services/project/ProjectMetaService";
import { studioWorkspaceStateService } from "../../services/project/StudioWorkspaceStateService";
import { domainService } from "../../services/publish/DomainService";

export const projectPublishProcedures = {
  /**
   * Publish a project version to a custom domain
   */
  publish: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        domain: z.string().min(1, "Domain is required"),
        expectedCommitHash: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version, domain, expectedCommitHash } = input;
      const userId = ctx.session.user.id;

      const allowlist = await domainService.ensurePublishDomainEnabled({
        organizationId,
        domain,
      });
      if (!allowlist.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: allowlist.message || "Domain is not enabled for this organization",
        });
      }

      const studioRunning = await studioMachineProvider.isRunning(organizationId, slug, version);
      if (studioRunning) {
        const workspaceState = studioWorkspaceStateService.getRecent(organizationId, slug, version);
        if (!workspaceState?.isFresh) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Studio is currently active. Open Studio and save before publishing.",
            cause: { reason: "studio_state_unavailable" },
          });
        }
        if (workspaceState.hasUnsavedChanges) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "You have unsaved changes in Studio. Save changes in Studio before publishing.",
            cause: { reason: "studio_unsaved_changes" },
          });
        }
        if (
          workspaceState.workingCommitHash &&
          workspaceState.headCommitHash &&
          workspaceState.workingCommitHash !== workspaceState.headCommitHash
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Studio is viewing an older snapshot. Restore it (or switch back to the latest snapshot) before publishing.",
            cause: { reason: "studio_older_snapshot" },
          });
        }
      }

      try {
        const result = await publishService.publish({
          organizationId,
          projectSlug: slug,
          version,
          domain,
          userId,
          expectedCommitHash,
        });

        return result;
      } catch (err) {
        if (err instanceof PublishConflictError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: err.message,
            cause: { reason: err.reason },
          });
        }
        throw err;
      }
    }),

  /**
   * Unpublish a project (remove from domain)
   */
  unpublish: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug } = input;

      await publishService.unpublish(organizationId, slug);

      return {
        success: true,
        message: "Site unpublished successfully",
      };
    }),

  /**
   * Get publish status for a project
   */
  publishStatus: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug } = input;

      const info = await publishService.getPublishedInfo(organizationId, slug);

      if (!info) {
        return {
          isPublished: false,
          domain: null,
          commitHash: null,
          publishedAt: null,
          url: null,
        };
      }

      // Determine URL scheme based on domain type
      const urlScheme = publishService.isDevDomain(info.domain)
        ? "http"
        : "https";

      return {
        isPublished: true,
        domain: info.domain,
        commitHash: info.commitHash,
        publishedAt: info.publishedAt.toISOString(),
        url: `${urlScheme}://${info.domain}`,
        projectVersion: info.projectVersion,
      };
    }),

  /**
   * Check if a domain is available for publishing
   */
  checkDomain: projectMemberProcedure
    .input(
      z.object({
        domain: z.string(),
        slug: z.string().optional(), // Current project slug for exclusion
      })
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { domain, slug } = input;

      // Normalize and validate
      const normalized = publishService.normalizeDomain(domain);
      const validation = publishService.validateDomain(normalized);

      if (!validation.valid) {
        return {
          available: false,
          normalizedDomain: normalized,
          error: validation.error,
        };
      }

      const allowlist = await domainService.ensurePublishDomainEnabled({
        organizationId,
        domain: normalized,
      });
      if (!allowlist.enabled) {
        return {
          available: false,
          normalizedDomain: normalized,
          error: allowlist.message || "Domain is not enabled for this organization",
        };
      }

      const available = await publishService.isDomainAvailable(
        normalized,
        slug ? { organizationId, projectSlug: slug } : undefined,
      );

      return {
        available,
        normalizedDomain: normalized,
        error: available ? undefined : "Domain is already in use",
      };
    }),

  /**
   * Publish dialog state for dashboard/studio UIs.
   * Exposes artifact readiness and unsaved-change hint inputs.
   */
  publishState: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version } = input;

      const [artifactState, studioRunning] = await Promise.all([
        resolvePublishableArtifactState({ organizationId, slug, version }),
        studioMachineProvider.isRunning(organizationId, slug, version),
      ]);
      const workspaceState = studioWorkspaceStateService.getRecent(organizationId, slug, version);
      const studioStateAvailable = Boolean(studioRunning && workspaceState?.isFresh);
      const studioHasUnsavedChanges = Boolean(
        studioStateAvailable && workspaceState?.hasUnsavedChanges,
      );

      return {
        storageEnabled: artifactState.storageEnabled,
        readiness: artifactState.readiness,
        sourceKind: artifactState.sourceKind,
        framework: artifactState.framework,
        publishableCommitHash: artifactState.commitHash,
        lastSyncedCommitHash: artifactState.sourceCommitHash ?? artifactState.commitHash,
        builtAt: artifactState.builtAt,
        sourceBuiltAt: artifactState.sourceBuiltAt,
        previewBuiltAt: artifactState.previewBuiltAt,
        error: artifactState.error,
        studioRunning,
        studioStateAvailable,
        studioHasUnsavedChanges,
        studioHeadCommitHash: workspaceState?.headCommitHash ?? null,
        studioWorkingCommitHash: workspaceState?.workingCommitHash ?? null,
        studioStateReportedAt: workspaceState?.reportedAt.toISOString() ?? null,
      };
    }),

  /**
   * Read checklist state from DB for publish UIs.
   */
  publishChecklist: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version } = input;
      const [checklist, versionMeta, artifactState] = await Promise.all([
        projectMetaService.getPublishChecklist({ organizationId, slug, version }),
        projectMetaService.getProjectVersion(organizationId, slug, version),
        resolvePublishableArtifactState({ organizationId, slug, version }),
      ]);

      if (!checklist) {
        return {
          checklist: null,
          stale: true,
          reason: "missing",
        };
      }

      let stale = false;
      let reason: "project_updated" | "hash_mismatch" | null = null;

      if (versionMeta && new Date(checklist.runAt).getTime() < versionMeta.updatedAt.getTime()) {
        stale = true;
        reason = "project_updated";
      }

      if (
        checklist.snapshotCommitHash &&
        artifactState.commitHash &&
        checklist.snapshotCommitHash !== artifactState.commitHash
      ) {
        stale = true;
        reason = "hash_mismatch";
      }

      return {
        checklist,
        stale,
        reason,
      };
    }),
};
