import { eq } from "drizzle-orm";
import { createContactFormPluginBackendContribution } from "@vivd/plugin-contact-form/backend/contribution";
import { contactFormPluginDefinition } from "@vivd/plugin-contact-form/backend/module";
import { db } from "../../../db";
import {
  contactFormRecipientVerification,
  contactFormSubmission,
  organizationMember,
  pluginEntitlement,
  projectMeta,
  projectPluginInstance,
} from "../../../db/schema";
import { emailDeliverabilityService, isSesFeedbackAutoConfirmEnabled } from "../../email/deliverability";
import {
  buildContactSubmissionEmail,
} from "../../email/templates";
import { getEmailDeliveryService } from "../../integrations/EmailDeliveryService";
import { pluginEntitlementService } from "../PluginEntitlementService";
import {
  ensureProjectPluginInstance,
  getProjectPluginInstance,
} from "../core/instanceStore";
import { getContactFormSubmitEndpoint } from "./publicApi";
import { contactFormRecipientVerificationService } from "./recipientVerification";
import { inferContactFormAutoSourceHosts } from "./sourceHosts";
import { contactFormTurnstileService } from "./turnstile";

export const contactFormPluginBackendContribution =
  createContactFormPluginBackendContribution({
    projectPluginInstanceService: {
      ensurePluginInstance(options) {
        return ensureProjectPluginInstance({
          ...options,
          defaultConfig: contactFormPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(options) {
        return getProjectPluginInstance(options);
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
    turnstileService: contactFormTurnstileService,
    getContactFormSubmitEndpoint,
    inferSourceHosts: inferContactFormAutoSourceHosts,
    emailDeliverabilityService,
    emailDeliveryService: getEmailDeliveryService(),
    buildContactSubmissionEmail,
    isSesFeedbackAutoConfirmEnabled,
    db,
    tables: {
      contactFormRecipientVerification,
      contactFormSubmission,
      pluginEntitlement,
      projectMeta,
      projectPluginInstance,
      organizationMember,
    },
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
