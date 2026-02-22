import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { projectPluginService } from "../../services/plugins/ProjectPluginService";

const projectSlugInput = z.object({
  slug: z.string().min(1),
});

export const catalogPluginProcedure = projectMemberProcedure
  .input(projectSlugInput)
  .query(async ({ ctx, input }) => {
    return projectPluginService.listCatalogForProject(ctx.organizationId!, input.slug);
  });
