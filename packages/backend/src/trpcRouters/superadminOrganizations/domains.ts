import { z } from "zod";
import { organizationIdSchema } from "../../lib/organizationIdentifiers";
import { domainService } from "../../services/publish/DomainService";
import { publishService } from "../../services/publish/PublishService";
import { superAdminProcedure } from "../../trpc";
import {
  domainStatusSchema,
  domainTypeSchema,
  domainUsageSchema,
} from "./shared";

export const organizationDomainSuperAdminProcedures = {
  listOrganizationDomains: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      const domains = await domainService.listOrganizationDomains(input.organizationId);
      return { domains };
    }),

  addOrganizationDomain: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        domain: z.string().min(1),
        usage: domainUsageSchema,
        type: domainTypeSchema,
        status: domainStatusSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await domainService.addOrganizationDomain({
        organizationId: input.organizationId,
        rawDomain: input.domain,
        usage: input.usage,
        type: input.type,
        status: input.status,
        createdById: ctx.session.user.id,
      });
      await publishService.syncGeneratedCaddyConfigs();

      return {
        success: true,
        domainId: result.id,
        domain: result.domain,
        created: result.created,
      };
    }),

  setOrganizationDomainStatus: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
        status: domainStatusSchema,
      }),
    )
    .mutation(async ({ input }) => {
      await domainService.setDomainStatus(input.domainId, input.status);
      await publishService.syncGeneratedCaddyConfigs();
      return { success: true };
    }),

  setOrganizationDomainUsage: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
        usage: domainUsageSchema,
      }),
    )
    .mutation(async ({ input }) => {
      await domainService.setDomainUsage(input.domainId, input.usage);
      await publishService.syncGeneratedCaddyConfigs();
      return { success: true };
    }),

  startDomainVerification: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const data = await domainService.startDomainVerification(input.domainId);
      return {
        success: true,
        verification: data,
      };
    }),

  checkDomainVerification: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await domainService.checkDomainVerification(input.domainId);
      return {
        success: result.verified,
        status: result.status,
        verification: result.verification,
      };
    }),

  removeOrganizationDomain: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await domainService.removeOrganizationDomain(input.domainId);
      await publishService.syncGeneratedCaddyConfigs();
      return {
        success: true,
        removed: result.removed,
      };
    }),
};
