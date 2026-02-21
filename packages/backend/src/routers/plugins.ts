import { z } from "zod";
import { projectMemberProcedure, router } from "../trpc";
import { projectPluginService } from "../services/plugins/ProjectPluginService";

const projectSlugInput = z.object({
  slug: z.string().min(1),
});

export const pluginsRouter = router({
  catalog: projectMemberProcedure
    .input(projectSlugInput)
    .query(async ({ ctx, input }) => {
      return projectPluginService.listCatalogForProject(ctx.organizationId!, input.slug);
    }),

  contactEnsure: projectMemberProcedure
    .input(projectSlugInput)
    .mutation(async ({ ctx, input }) => {
      return projectPluginService.ensureContactFormPlugin({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
      });
    }),

  contactInfo: projectMemberProcedure
    .input(projectSlugInput)
    .query(async ({ ctx, input }) => {
      return projectPluginService.getContactFormInfo({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
      });
    }),
});
