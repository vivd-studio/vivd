import type {
  PluginModule,
} from "@vivd/shared/types";
import {
  createContactFormPluginModule,
  contactFormPluginConfigSchema,
  contactFormPluginDefinition,
  type ContactFormPluginConfig,
} from "@vivd/plugin-contact-form/backend/module";
import {
  ContactFormPluginNotEnabledError,
  ContactFormRecipientRequiredError,
  ContactFormRecipientVerificationError,
  contactFormPluginService,
} from "./service";
import {
  ContactRecipientEmailFormatError,
  ContactRecipientVerificationPendingLimitError,
  ContactRecipientVerificationSendError,
} from "./recipientVerification";
import { ContactRecipientVerificationEndpointUnavailableError } from "./publicApi";

export { contactFormPluginConfigSchema, contactFormPluginDefinition };
export type { ContactFormPluginConfig };

export const contactFormPluginModule: PluginModule<"contact_form"> = {
  ...createContactFormPluginModule({
    async ensurePlugin(options) {
      const result = await contactFormPluginService.ensureContactFormPlugin(options);
      return {
        instanceId: result.instanceId,
        created: result.created,
        status: result.status,
      };
    },
    getInfo(options) {
      return contactFormPluginService.getContactFormInfo(options);
    },
    async updateConfig(options) {
      await contactFormPluginService.updateContactFormConfig(options);
      return contactFormPluginService.getContactFormInfo(options);
    },
    requestRecipientVerification(options) {
      return contactFormPluginService.requestRecipientVerification(options);
    },
    markRecipientVerified(options) {
      return contactFormPluginService.markRecipientVerified(options);
    },
    mapPublicError(context) {
      const { error } = context;
      if (
        error instanceof ContactFormRecipientVerificationError ||
        error instanceof ContactFormRecipientRequiredError ||
        error instanceof ContactFormPluginNotEnabledError ||
        error instanceof ContactRecipientEmailFormatError ||
        error instanceof ContactRecipientVerificationPendingLimitError
      ) {
        return {
          code: "BAD_REQUEST" as const,
          message: error.message,
        };
      }
      if (error instanceof ContactRecipientVerificationSendError) {
        return {
          code: "INTERNAL_SERVER_ERROR" as const,
          message: error.message,
        };
      }
      if (error instanceof ContactRecipientVerificationEndpointUnavailableError) {
        return {
          code: "INTERNAL_SERVER_ERROR" as const,
          message:
            "Could not generate verification link for this host. Please contact support.",
        };
      }
      return null;
    },
  }),
};
