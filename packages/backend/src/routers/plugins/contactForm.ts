import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { projectPluginService } from "../../services/plugins/ProjectPluginService";
import { contactFormPluginConfigSchema } from "../../services/plugins/contactForm/config";

const projectSlugInput = z.object({
  slug: z.string().min(1),
});

const contactConfigInput = z.object({
  slug: z.string().min(1),
  config: contactFormPluginConfigSchema,
});

export const contactEnsurePluginProcedure = projectMemberProcedure
  .input(projectSlugInput)
  .mutation(async ({ ctx, input }) => {
    return projectPluginService.ensureContactFormPlugin({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
    });
  });

export const contactInfoPluginProcedure = projectMemberProcedure
  .input(projectSlugInput)
  .query(async ({ ctx, input }) => {
    return projectPluginService.getContactFormInfo({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
    });
  });

export const contactUpdateConfigPluginProcedure = projectMemberProcedure
  .input(contactConfigInput)
  .mutation(async ({ ctx, input }) => {
    return projectPluginService.updateContactFormConfig({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      config: input.config,
    });
  });
