import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  organizationInvitationService,
} from "../../services/auth/OrganizationInvitationService";
import {
  orgAdminProcedure,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import {
  enforceInviteRateLimit,
  getOrganizationInvitationErrorMessage,
  memberRoleSchema,
} from "./shared";

export const organizationInvitationProcedures = {
  listInvitations: orgAdminProcedure.query(async ({ ctx }) => {
    try {
      return await organizationInvitationService.listOrganizationInvitations(
        ctx.organizationId!,
      );
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: getOrganizationInvitationErrorMessage(
          error,
          "Failed to load invitations",
        ),
      });
    }
  }),

  inviteMember: orgAdminProcedure
    .input(
      z
        .object({
          email: z.string().email(),
          name: z.string().min(1).max(128).optional(),
          role: memberRoleSchema.optional().default("member"),
          projectSlug: z.string().min(1).optional(),
        })
        .refine((data) => (data.role === "client_editor" ? !!data.projectSlug : true), {
          message: "Project is required for client editor accounts",
          path: ["projectSlug"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: ctx.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.inviteMember({
          organizationId: ctx.organizationId!,
          email: input.email,
          inviteeName: input.name,
          role: input.role,
          projectSlug: input.projectSlug,
          inviterId: ctx.session.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to send invitation",
          ),
        });
      }
    }),

  resendInvitation: orgAdminProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: ctx.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.resendInvite({
          invitationId: input.invitationId,
          organizationId: ctx.organizationId!,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to resend invitation",
          ),
        });
      }
    }),

  cancelInvitation: orgAdminProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await organizationInvitationService.cancelInvite({
          invitationId: input.invitationId,
          organizationId: ctx.organizationId!,
        });
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to cancel invitation",
          ),
        });
      }
    }),

  getInviteDetails: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      try {
        const invitation = await organizationInvitationService.getPublicInvite(
          input.token,
        );
        if (!invitation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invitation not found",
          });
        }
        return invitation;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to load invitation",
          ),
        });
      }
    }),

  acceptInviteWithSignup: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        name: z.string().min(2).max(128),
        password: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: null,
        requestIp: ctx.requestIp,
        userId: null,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.acceptInviteWithSignup(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to accept invitation",
          ),
        });
      }
    }),

  acceptInviteForSignedInUser: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: ctx.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.acceptInviteForUser({
          token: input.token,
          sessionId: ctx.session.session.id,
          userId: ctx.session.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to accept invitation",
          ),
        });
      }
    }),
};
