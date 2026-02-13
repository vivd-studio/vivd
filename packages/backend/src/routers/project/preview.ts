import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, projectMemberProcedure } from "../../trpc";
import { getVersionDir } from "../../generator/versionUtils";
import { buildService } from "../../services/BuildService";
import { detectProjectType } from "../../devserver/projectType";
import fs from "node:fs";
import { resolvePublishableArtifactState } from "../../services/ProjectArtifactStateService";
import { projectMetaService } from "../../services/ProjectMetaService";
import { domainService } from "../../services/DomainService";
import { publishService } from "../../services/PublishService";

export const previewProcedures = {
  /**
   * Get the external preview status and URL for a project version.
   * Returns build status for Astro projects, or ready for static projects.
   * Always returns the /preview/ URL for external sharing.
   */
  getExternalPreviewStatus: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version } = input;

      const previewPath = `/vivd-studio/api/preview/${slug}/v${version}/`;
      const tenantHost = await domainService.getActiveTenantHostForOrganization(
        organizationId,
        {
          preferredTenantBaseDomain: domainService.inferTenantBaseDomainFromHost(
            ctx.requestDomain,
          ),
        },
      );
      const urlHost = tenantHost ?? ctx.requestHost;
      const scheme =
        urlHost && publishService.isDevDomain(urlHost)
          ? "http"
          : "https";
      const url = urlHost
        ? new URL(previewPath, `${scheme}://${urlHost}`).toString()
        : previewPath;

      const project = await projectMetaService.getProject(organizationId, slug);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const publicPreviewEnabled = project.publicPreviewEnabled;

      const artifactState = await resolvePublishableArtifactState({
        organizationId,
        slug,
        version,
      });
      if (artifactState.storageEnabled) {
        if (artifactState.readiness === "ready") {
          return {
            mode: artifactState.sourceKind === "preview" ? ("built" as const) : ("static" as const),
            status: "ready" as const,
            url,
            canonicalUrl: url,
            publicPreviewEnabled,
          };
        }
        if (artifactState.readiness === "build_in_progress") {
          return {
            mode: "built" as const,
            status: "building" as const,
            url,
            canonicalUrl: url,
            publicPreviewEnabled,
            error: artifactState.error ?? undefined,
          };
        }
        if (artifactState.readiness === "artifact_not_ready") {
          return {
            mode: "built" as const,
            status: "error" as const,
            url,
            canonicalUrl: url,
            publicPreviewEnabled,
            error: artifactState.error ?? undefined,
          };
        }

        return {
          mode: "built" as const,
          status: "pending" as const,
          url,
          canonicalUrl: url,
          publicPreviewEnabled,
          error: artifactState.error ?? undefined,
        };
      }

      // Fallback for local standalone mode without object storage.
      const versionDir = getVersionDir(organizationId, slug, version);
      const config = fs.existsSync(versionDir)
        ? detectProjectType(versionDir)
        : { framework: "generic" as const, mode: "static" as const, packageManager: "npm" as const };

      if (config.framework !== "astro") {
        return {
          mode: "static" as const,
          status: "ready" as const,
          url,
          canonicalUrl: url,
          publicPreviewEnabled,
        };
      }

      // Check if build exists (in memory or on disk via getBuildPath)
      const buildPath = buildService.getBuildPath(versionDir);
      if (buildPath) {
        return {
          mode: "built" as const,
          status: "ready" as const,
          url,
          canonicalUrl: url,
          publicPreviewEnabled,
        };
      }

      const buildStatus = buildService.getBuildStatus(versionDir);
      return {
        mode: "built" as const,
        status: buildStatus?.status || ("pending" as const),
        url,
        canonicalUrl: url,
        publicPreviewEnabled,
        error: buildStatus?.error,
      };
    }),

  setPublicPreviewEnabled: adminProcedure
    .input(
      z.object({
        slug: z.string(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const project = await projectMetaService.getProject(organizationId, input.slug);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      await projectMetaService.setPublicPreviewEnabled({
        organizationId,
        slug: input.slug,
        enabled: input.enabled,
      });

      return {
        success: true,
        slug: input.slug,
        publicPreviewEnabled: input.enabled,
      };
    }),
};
