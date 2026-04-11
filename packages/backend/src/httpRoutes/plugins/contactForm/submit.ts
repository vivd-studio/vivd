import { createContactFormPublicRouter as createPluginContactFormPublicRouter } from "@vivd/plugin-contact-form/backend/http/submit";
import { db } from "../../../db";
import { contactFormSubmission, projectPluginInstance } from "../../../db/schema";
import { emailDeliverabilityService } from "../../../services/email/deliverability";
import { buildContactSubmissionEmail } from "../../../services/email/templates";
import { getEmailDeliveryService } from "../../../services/integrations/EmailDeliveryService";
import { pluginEntitlementService } from "../../../services/plugins/PluginEntitlementService";
import { inferContactFormAutoSourceHosts } from "../../../services/plugins/contactForm/sourceHosts";
import { contactFormTurnstileService } from "../../../services/plugins/contactForm/turnstile";

export function createContactFormPublicRouter(deps: {
  upload: {
    none(): any;
  };
}) {
  return createPluginContactFormPublicRouter({
    upload: deps.upload,
    db,
    tables: {
      contactFormSubmission,
      projectPluginInstance,
    },
    pluginEntitlementService,
    inferSourceHosts: inferContactFormAutoSourceHosts,
    turnstileService: contactFormTurnstileService,
    buildContactSubmissionEmail,
    emailDeliveryService: getEmailDeliveryService(),
    emailDeliverabilityService,
  });
}
