import { eq } from "drizzle-orm";
import { createContactFormPluginBackendHooks } from "@vivd/plugin-contact-form/backend/adminHooks";
import { contactFormPluginDefinition } from "@vivd/plugin-contact-form/backend/module";
import {
  contactFormBackendPluginPackage,
} from "@vivd/plugin-contact-form/backend/plugin";
import type { ContactFormPluginEntitlementServicePort } from "@vivd/plugin-contact-form/backend/ports";
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
import {
  ensureProjectPluginInstance,
  getProjectPluginInstance,
} from "../core/instanceStore";
import { getContactFormSubmitEndpoint } from "./publicApi";
import { contactFormRecipientVerificationService } from "./recipientVerification";
import { inferContactFormAutoSourceHosts } from "./sourceHosts";
import { contactFormTurnstileService } from "./turnstile";

export const contactFormBackendPluginHooks =
  createContactFormPluginBackendHooks({
    db,
    tables: {
      contactFormSubmission,
      contactFormRecipientVerification,
      pluginEntitlement,
    },
    turnstileService: contactFormTurnstileService,
  });

export function createContactFormBackendHostPluginContribution(options: {
  pluginEntitlementService: ContactFormPluginEntitlementServicePort;
}) {
  const contribution = contactFormBackendPluginPackage.backend.createContribution({
    projectPluginInstanceService: {
      ensurePluginInstance(hostOptions) {
        return ensureProjectPluginInstance({
          ...hostOptions,
          defaultConfig: contactFormPluginDefinition.defaultConfig,
        });
      },
      getPluginInstance(hostOptions) {
        return getProjectPluginInstance(hostOptions);
      },
      async updatePluginInstance(hostOptions) {
        const updates: {
          configJson?: unknown;
          status?: string;
          updatedAt: Date;
        } = {
          updatedAt: hostOptions.updatedAt ?? new Date(),
        };
        if (Object.prototype.hasOwnProperty.call(hostOptions, "configJson")) {
          updates.configJson = hostOptions.configJson;
        }
        if (typeof hostOptions.status === "string") {
          updates.status = hostOptions.status;
        }

        const [updated] = await db
          .update(projectPluginInstance)
          .set(updates)
          .where(eq(projectPluginInstance.id, hostOptions.instanceId))
          .returning();

        return updated ?? null;
      },
    },
    pluginEntitlementService: options.pluginEntitlementService,
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
    async listVerifiedOrganizationMemberEmails(hostOptions) {
      const members = await db.query.organizationMember.findMany({
        where: eq(organizationMember.organizationId, hostOptions.organizationId),
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

  return {
    ...contribution,
    hooks: contactFormBackendPluginHooks,
  };
}

export const contactFormBackendHostPlugin = {
  pluginId: contactFormBackendPluginPackage.pluginId,
  hooks: contactFormBackendPluginHooks,
  createContribution: createContactFormBackendHostPluginContribution,
} as const;
