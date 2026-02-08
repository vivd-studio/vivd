import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { projectMemberProcedure } from "../../trpc";
import {
  publishService,
  PublishConflictError,
} from "../../services/PublishService";
import { resolvePublishableArtifactState } from "../../services/ProjectArtifactStateService";
import { studioMachineProvider } from "../../services/studioMachines";
import { projectMetaService } from "../../services/ProjectMetaService";

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
      const { slug, version, domain, expectedCommitHash } = input;
      const userId = ctx.session.user.id;

      try {
        const result = await publishService.publish({
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
    .mutation(async ({ input }) => {
      const { slug } = input;

      await publishService.unpublish(slug);

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
    .query(async ({ input }) => {
      const { slug } = input;

      const info = await publishService.getPublishedInfo(slug);

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
    .query(async ({ input }) => {
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

      const available = await publishService.isDomainAvailable(normalized, slug);

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
    .query(async ({ input }) => {
      const { slug, version } = input;

      const [artifactState, studioRunning] = await Promise.all([
        resolvePublishableArtifactState({ slug, version }),
        studioMachineProvider.isRunning(slug, version),
      ]);

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
    .query(async ({ input }) => {
      const { slug, version } = input;
      const [checklist, versionMeta, artifactState] = await Promise.all([
        projectMetaService.getPublishChecklist({ slug, version }),
        projectMetaService.getProjectVersion(slug, version),
        resolvePublishableArtifactState({ slug, version }),
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
