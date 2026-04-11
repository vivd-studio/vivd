import { createEmailFeedbackRouter as createPluginEmailFeedbackRouter } from "@vivd/plugin-contact-form/backend/http/feedback";
import {
  emailDeliverabilityService,
  isSesFeedbackAutoConfirmEnabled,
} from "../../../services/email/deliverability";

export function createEmailFeedbackRouter() {
  return createPluginEmailFeedbackRouter({
    emailDeliverabilityService,
    isSesFeedbackAutoConfirmEnabled,
  });
}
