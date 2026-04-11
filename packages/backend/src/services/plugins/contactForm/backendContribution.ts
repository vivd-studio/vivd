import { eq } from "drizzle-orm";
import { createContactFormPluginBackendContribution } from "@vivd/plugin-contact-form/backend/contribution";
import { db } from "../../../db";
import { organizationMember, projectPluginInstance } from "../../../db/schema";
import { pluginEntitlementService } from "../PluginEntitlementService";
import { projectPluginInstanceService } from "../core/instanceService";
import { getContactFormSubmitEndpoint } from "./publicApi";
import { contactFormRecipientVerificationService } from "./recipientVerification";
import { inferContactFormAutoSourceHosts } from "./sourceHosts";

export const contactFormPluginBackendContribution =
  createContactFormPluginBackendContribution({
    projectPluginInstanceService: {
      ensurePluginInstance(options) {
        return projectPluginInstanceService.ensurePluginInstance(options);
      },
      getPluginInstance(options) {
        return projectPluginInstanceService.getPluginInstance(options);
      },
      async updatePluginInstance(options) {
        const updates: {
          configJson?: unknown;
          status?: string;
          updatedAt: Date;
        } = {
          updatedAt: options.updatedAt ?? new Date(),
        };
        if (Object.prototype.hasOwnProperty.call(options, "configJson")) {
          updates.configJson = options.configJson;
        }
        if (typeof options.status === "string") {
          updates.status = options.status;
        }

        const [updated] = await db
          .update(projectPluginInstance)
          .set(updates)
          .where(eq(projectPluginInstance.id, options.instanceId))
          .returning();

        return updated ?? null;
      },
    },
    pluginEntitlementService,
    recipientVerificationService: contactFormRecipientVerificationService,
    getContactFormSubmitEndpoint,
    inferSourceHosts: inferContactFormAutoSourceHosts,
    async listVerifiedOrganizationMemberEmails(options) {
      const members = await db.query.organizationMember.findMany({
        where: eq(organizationMember.organizationId, options.organizationId),
        with: {
          user: {
            columns: {
              email: true,
              emailVerified: true,
            },
          },
        },
      });

      return members
        .filter((member) => member.user.emailVerified)
        .map((member) => member.user.email);
    },
  });

export const contactFormPluginService = contactFormPluginBackendContribution.service;
export const contactFormPluginModule = contactFormPluginBackendContribution.module;
export const contactFormPluginPublicRoutes =
  contactFormPluginBackendContribution.publicRoutes;
