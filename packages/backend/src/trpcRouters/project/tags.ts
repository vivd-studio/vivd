import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure } from "../../trpc";
import { getManifest } from "../../generator/versionUtils";
import { projectMetaService } from "../../services/project/ProjectMetaService";
import {
  MAX_PROJECT_TAGS,
  ProjectTagsValidationError,
  normalizeProjectTags,
} from "../../services/project/projectTags";

export const projectTagProcedures = {
  updateTags: adminProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        tags: z.array(z.string()).max(MAX_PROJECT_TAGS * 4),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug } = input;

      const manifest = await getManifest(organizationId, slug);
      if (!manifest) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      let normalizedTags: string[];
      try {
        normalizedTags = normalizeProjectTags(input.tags);
      } catch (error) {
        if (error instanceof ProjectTagsValidationError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }

      await projectMetaService.setTags({
        organizationId,
        slug,
        tags: normalizedTags,
      });

      return {
        success: true,
        slug,
        tags: normalizedTags,
      };
    }),
  deleteTag: adminProcedure
    .input(
      z.object({
        tag: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;

      let normalizedTag: string;
      try {
        normalizedTag = normalizeProjectTags([input.tag])[0] ?? "";
      } catch (error) {
        if (error instanceof ProjectTagsValidationError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }

      if (!normalizedTag) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tag cannot be empty.",
        });
      }

      const result = await projectMetaService.removeTagFromOrganization({
        organizationId,
        tag: normalizedTag,
      });

      return {
        success: true,
        tag: normalizedTag,
        updatedProjects: result.updatedSlugs.length,
      };
    }),
};
