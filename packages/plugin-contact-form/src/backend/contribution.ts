import type { PluginModule } from "@vivd/shared/types";
import { createContactFormPluginBackendHooks } from "./adminHooks";
import { createEmailFeedbackRouter } from "./http/feedback";
import { createContactRecipientVerificationRouter } from "./http/recipientVerification";
import { createContactFormPublicRouter } from "./http/submit";
import { createContactFormPluginModule } from "./module";
import {
  ContactRecipientEmailFormatError,
  ContactRecipientVerificationPendingLimitError,
  ContactRecipientVerificationSendError,
} from "./recipientVerification";
import {
  ContactFormPluginNotEnabledError,
  ContactFormRecipientRequiredError,
  ContactFormRecipientVerificationError,
  createContactFormPluginService,
  type ContactFormPluginService,
} from "./service";
import type {
  ContactFormBackendRouteDefinition,
  ContactFormPluginBackendContributionDeps,
} from "./ports";

export interface ContactFormPluginBackendContribution {
  service: ContactFormPluginService;
  module: PluginModule<"contact_form">;
  hooks: ReturnType<typeof createContactFormPluginBackendHooks>;
  publicRoutes: ReadonlyArray<ContactFormBackendRouteDefinition>;
}

export function createContactFormPluginBackendContribution(
  deps: ContactFormPluginBackendContributionDeps,
): ContactFormPluginBackendContribution {
  const service = createContactFormPluginService(deps);
  const hooks = createContactFormPluginBackendHooks({
    db: deps.db,
    tables: {
      contactFormSubmission: deps.tables.contactFormSubmission,
      contactFormRecipientVerification:
        deps.tables.contactFormRecipientVerification,
      pluginEntitlement: deps.tables.pluginEntitlement,
    },
    turnstileService: deps.turnstileService,
  });

  return {
    service,
    module: createContactFormPluginModule({
      async ensurePlugin(options) {
        const result = await service.ensureContactFormPlugin(options);
        return {
          instanceId: result.instanceId,
          created: result.created,
          status: result.status,
        };
      },
      getInfo(options) {
        return service.getContactFormInfo(options);
      },
      async updateConfig(options) {
        await service.updateContactFormConfig(options);
        return service.getContactFormInfo(options);
      },
      requestRecipientVerification(options) {
        return service.requestRecipientVerification(options);
      },
      markRecipientVerified(options) {
        return service.markRecipientVerified(options);
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
        if (
          error instanceof Error &&
          error.name === "ContactRecipientVerificationEndpointUnavailableError"
        ) {
          return {
            code: "INTERNAL_SERVER_ERROR" as const,
            message:
              "Could not generate verification link for this host. Please contact support.",
          };
        }
        return null;
      },
    }),
    hooks,
    publicRoutes: [
      {
        routeId: "contact_form.email_feedback",
        mountPath: "",
        createRouter: () =>
          createEmailFeedbackRouter({
            emailDeliverabilityService: deps.emailDeliverabilityService,
            isSesFeedbackAutoConfirmEnabled:
              deps.isSesFeedbackAutoConfirmEnabled,
          }),
      },
      {
        routeId: "contact_form.recipient_verification",
        mountPath: "/plugins",
        createRouter: () =>
          createContactRecipientVerificationRouter({
            recipientVerificationService: deps.recipientVerificationService,
          }),
      },
      {
        routeId: "contact_form.submit",
        mountPath: "/plugins",
        createRouter: (routeDeps) =>
          createContactFormPublicRouter({
            upload: routeDeps.upload,
            db: deps.db,
            tables: {
              contactFormSubmission: deps.tables.contactFormSubmission,
              projectPluginInstance: deps.tables.projectPluginInstance,
            },
            pluginEntitlementService: deps.pluginEntitlementService,
            inferSourceHosts: deps.inferSourceHosts,
            turnstileService: deps.turnstileService,
            buildContactSubmissionEmail: deps.buildContactSubmissionEmail,
            emailDeliveryService: deps.emailDeliveryService,
            emailDeliverabilityService: deps.emailDeliverabilityService,
          }),
      },
    ],
  };
}
