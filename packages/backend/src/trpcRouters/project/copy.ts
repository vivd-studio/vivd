import { z } from "zod";
import { adminProcedure } from "../../trpc";
import { projectCopyService } from "../../services/project/ProjectCopyService";

const optionalTrimmedString = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1))
  .optional();

export const projectCopyProcedures = {
  duplicateProject: adminProcedure
    .input(
      z.object({
        sourceSlug: z.string().min(1),
        sourceVersion: z.number().int().positive().optional(),
        title: optionalTrimmedString,
        slug: optionalTrimmedString,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await projectCopyService.duplicateProject({
        organizationId: ctx.organizationId!,
        sourceSlug: input.sourceSlug.trim(),
        sourceVersion: input.sourceVersion,
        title: input.title,
        slug: input.slug,
      });

      return {
        ...result,
        message: `Duplicated ${result.sourceSlug} v${result.sourceVersion} as ${result.targetSlug}`,
      };
    }),
};
