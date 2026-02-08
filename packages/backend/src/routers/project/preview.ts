import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { getVersionDir } from "../../generator/versionUtils";
import { buildService } from "../../services/BuildService";
import { detectProjectType } from "../../devserver/projectType";
import fs from "node:fs";
import { resolvePublishableArtifactState } from "../../services/ProjectArtifactStateService";

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
    .query(async ({ input }) => {
      const { slug, version } = input;

      // External preview URL is always /preview/ (static serving)
      const url = `/vivd-studio/api/preview/${slug}/v${version}/`;

      const artifactState = await resolvePublishableArtifactState({ slug, version });
      if (artifactState.storageEnabled) {
        if (artifactState.readiness === "ready") {
          return {
            mode: artifactState.sourceKind === "preview" ? ("built" as const) : ("static" as const),
            status: "ready" as const,
            url,
          };
        }
        if (artifactState.readiness === "build_in_progress") {
          return {
            mode: "built" as const,
            status: "building" as const,
            url,
            error: artifactState.error ?? undefined,
          };
        }
        if (artifactState.readiness === "artifact_not_ready") {
          return {
            mode: "built" as const,
            status: "error" as const,
            url,
            error: artifactState.error ?? undefined,
          };
        }

        return {
          mode: "built" as const,
          status: "pending" as const,
          url,
          error: artifactState.error ?? undefined,
        };
      }

      // Fallback for local standalone mode without object storage.
      const versionDir = getVersionDir(slug, version);
      const config = fs.existsSync(versionDir)
        ? detectProjectType(versionDir)
        : { framework: "generic" as const, mode: "static" as const, packageManager: "npm" as const };

      if (config.framework !== "astro") {
        return {
          mode: "static" as const,
          status: "ready" as const,
          url,
        };
      }

      // Check if build exists (in memory or on disk via getBuildPath)
      const buildPath = buildService.getBuildPath(versionDir);
      if (buildPath) {
        return {
          mode: "built" as const,
          status: "ready" as const,
          url,
        };
      }

      const buildStatus = buildService.getBuildStatus(versionDir);
      return {
        mode: "built" as const,
        status: buildStatus?.status || ("pending" as const),
        url,
        error: buildStatus?.error,
      };
    }),
};
