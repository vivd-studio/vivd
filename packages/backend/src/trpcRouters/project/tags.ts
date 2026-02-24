import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, projectMemberProcedure } from "../../trpc";
import { getManifest } from "../../generator/versionUtils";
import { projectMetaService } from "../../services/project/ProjectMetaService";
import {
  MAX_PROJECT_TAGS,
  ProjectTagsValidationError,
  normalizeProjectTags,
} from "../../services/project/projectTags";

export const projectTagProcedures = {
  listTags: projectMemberProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;
    const tags = await projectMetaService.listOrganizationTags({
      organizationId,
    });
    return { tags };
  }),
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
  renameTag: adminProcedure
    .input(
      z.object({
        fromTag: z.string().min(1),
        toTag: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;

      let fromTag: string;
      let toTag: string;
      try {
        fromTag = normalizeProjectTags([input.fromTag])[0] ?? "";
        toTag = normalizeProjectTags([input.toTag])[0] ?? "";
      } catch (error) {
        if (error instanceof ProjectTagsValidationError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }

      if (!fromTag || !toTag) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tags cannot be empty.",
        });
      }

      const result = await projectMetaService.renameTagInOrganization({
        organizationId,
        fromTag,
        toTag,
      });

      return {
        success: true,
        fromTag,
        toTag,
        updatedProjects: result.updatedSlugs.length,
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
  setTagColor: adminProcedure
    .input(
      z.object({
        tag: z.string().min(1),
        colorId: z.string().min(1),
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

      await projectMetaService.setTagColor({
        organizationId,
        tag: normalizedTag,
        colorId: input.colorId,
      });

      return {
        success: true,
        tag: normalizedTag,
        colorId: input.colorId,
      };
    }),
};
