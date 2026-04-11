import { z } from "zod";
import { superAdminProcedure } from "../trpc";
import { getEmailFeedbackEndpoint } from "../services/plugins/contactForm/publicApi";
import { emailDeliverabilityService } from "../services/email/deliverability";
import {
  emailTemplateBrandingPatchInputSchema,
  emailTemplateBrandingService,
} from "../services/email/templateBranding";

const emailDeliverabilityPolicyInputSchema = z.object({
  autoSuppressBounces: z.boolean(),
  autoSuppressComplaints: z.boolean(),
  complaintRateThresholdPercent: z.number().min(0).max(100),
  bounceRateThresholdPercent: z.number().min(0).max(100),
});

async function buildEmailOverviewPayload() {
  const [overview, branding, sesEndpoint, resendEndpoint] = await Promise.all([
    emailDeliverabilityService.getOverview(),
    emailTemplateBrandingService.getResolvedBranding(),
    getEmailFeedbackEndpoint("ses"),
    getEmailFeedbackEndpoint("resend"),
  ]);

  return {
    ...overview,
    templateBranding: branding,
    webhookEndpoints: {
      ses: sesEndpoint,
      resend: resendEndpoint,
    },
  };
}

export const emailSuperAdminProcedures = {
  emailDeliverabilityOverview: superAdminProcedure.query(async () =>
    buildEmailOverviewPayload(),
  ),

  emailDeliverabilityUpdatePolicy: superAdminProcedure
    .input(emailDeliverabilityPolicyInputSchema)
    .mutation(async ({ input }) => {
      await emailDeliverabilityService.updatePolicy(input);
      return buildEmailOverviewPayload();
    }),

  emailDeliverabilityUnsuppressRecipient: superAdminProcedure
    .input(
      z.object({
        email: z.string().email(),
      }),
    )
    .mutation(async ({ input }) => {
      await emailDeliverabilityService.unsuppressRecipient({
        email: input.email,
      });
      return buildEmailOverviewPayload();
    }),

  emailTemplateBrandingUpdate: superAdminProcedure
    .input(emailTemplateBrandingPatchInputSchema)
    .mutation(async ({ input }) => {
      await emailTemplateBrandingService.updateBranding(input);
      return buildEmailOverviewPayload();
    }),
};
