import { createNewsletterPluginBackendHooks } from "@vivd/plugin-newsletter/backend/integrationHooks";
import { db } from "../../../db";
import { newsletterActionToken, newsletterSubscriber } from "../../../db/schema";

export const newsletterPluginBackendHooks =
  createNewsletterPluginBackendHooks({
    db,
    tables: {
      newsletterSubscriber,
      newsletterActionToken,
    },
  });
