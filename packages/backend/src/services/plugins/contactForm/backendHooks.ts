import { createContactFormPluginBackendHooks } from "@vivd/plugin-contact-form/backend/adminHooks";
import { db } from "../../../db";
import {
  contactFormRecipientVerification,
  pluginEntitlement,
} from "../../../db/schema";
import { contactFormTurnstileService } from "./turnstile";

export const contactFormPluginBackendHooks =
  createContactFormPluginBackendHooks({
    db,
    tables: {
      contactFormRecipientVerification,
      pluginEntitlement,
    },
    turnstileService: contactFormTurnstileService,
  });
