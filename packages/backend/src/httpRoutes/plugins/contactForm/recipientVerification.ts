import { createContactRecipientVerificationRouter as createPluginContactRecipientVerificationRouter } from "@vivd/plugin-contact-form/backend/http/recipientVerification";
import { contactFormRecipientVerificationService } from "../../../services/plugins/contactForm/recipientVerification";

export function createContactRecipientVerificationRouter() {
  return createPluginContactRecipientVerificationRouter({
    recipientVerificationService: contactFormRecipientVerificationService,
  });
}
