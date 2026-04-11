import { createContactFormRecipientVerificationService } from "@vivd/plugin-contact-form/backend/recipientVerification";
import { db } from "../../../db";
import {
  contactFormRecipientVerification,
  organizationMember,
  projectPluginInstance,
} from "../../../db/schema";
import { buildContactRecipientVerificationEmail } from "../../email/templates";
import { getEmailDeliveryService } from "../../integrations/EmailDeliveryService";
import { getContactRecipientVerificationEndpoint } from "./publicApi";

export * from "@vivd/plugin-contact-form/backend/recipientVerification";

export const contactFormRecipientVerificationService =
  createContactFormRecipientVerificationService({
    db,
    tables: {
      contactFormRecipientVerification,
      organizationMember,
      projectPluginInstance,
    },
    getContactRecipientVerificationEndpoint,
    buildRecipientVerificationEmail: buildContactRecipientVerificationEmail,
    emailDeliveryService: getEmailDeliveryService(),
  });
