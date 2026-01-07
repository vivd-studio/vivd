import { z } from "zod";
import { protectedProcedure } from "../../trpc";
import { publishService } from "../../services/PublishService";

export const projectPublishProcedures = {
  /**
   * Publish a project version to a custom domain
   */
  publish: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        domain: z.string().min(1, "Domain is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { slug, version, domain } = input;
      const userId = ctx.session.user.id;

      const result = await publishService.publish({
        projectSlug: slug,
        version,
        domain,
        userId,
      });

      return result;
    }),

  /**
   * Unpublish a project (remove from domain)
   */
  unpublish: protectedProcedure
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
  publishStatus: protectedProcedure
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
  checkDomain: protectedProcedure
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
};

