import { z } from "zod";
import { organizationIdSchema } from "../../lib/organizationIdentifiers";
import { organizationInvitationService } from "../../services/auth/OrganizationInvitationService";
import { superAdminProcedure } from "../../trpc";
import {
  enforceInviteRateLimit,
  getOrganizationInvitationErrorMessage,
  organizationRoleSchema,
} from "./shared";

export const organizationInvitationSuperAdminProcedures = {
  listOrganizationInvitations: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      try {
        return await organizationInvitationService.listOrganizationInvitations(
          input.organizationId,
        );
      } catch (error) {
        throw new Error(
          getOrganizationInvitationErrorMessage(
            error,
            "Failed to load invitations",
          ),
        );
      }
    }),

  inviteOrganizationMember: superAdminProcedure
    .input(
      z
        .object({
          organizationId: organizationIdSchema,
          email: z.string().email(),
          name: z.string().min(1).max(128).optional(),
          organizationRole: organizationRoleSchema.optional().default("admin"),
          projectSlug: z.string().min(1).optional(),
        })
        .refine(
          (data) =>
            data.organizationRole === "client_editor" ? !!data.projectSlug : true,
          {
            message: "Project is required for client editor accounts",
            path: ["projectSlug"],
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: input.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.inviteMember({
          organizationId: input.organizationId,
          email: input.email,
          inviteeName: input.name,
          role: input.organizationRole,
          projectSlug: input.projectSlug,
          inviterId: ctx.session.user.id,
        });
      } catch (error) {
        throw new Error(
          getOrganizationInvitationErrorMessage(
            error,
            "Failed to send invitation",
          ),
        );
      }
    }),

  resendOrganizationInvitation: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        invitationId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: input.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.resendInvite({
          organizationId: input.organizationId,
          invitationId: input.invitationId,
        });
      } catch (error) {
        throw new Error(
          getOrganizationInvitationErrorMessage(
            error,
            "Failed to resend invitation",
          ),
        );
      }
    }),

  cancelOrganizationInvitation: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        invitationId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        await organizationInvitationService.cancelInvite({
          organizationId: input.organizationId,
          invitationId: input.invitationId,
        });
        return { success: true };
      } catch (error) {
        throw new Error(
          getOrganizationInvitationErrorMessage(
            error,
            "Failed to cancel invitation",
          ),
        );
      }
    }),
};
