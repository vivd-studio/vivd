import type express from "express";
import type { Multer } from "multer";
import { createAnalyticsPublicRouter } from "./analytics/runtime";
import { createContactFormPublicRouter } from "./contactForm/submit";
import { createContactRecipientVerificationRouter } from "./contactForm/recipientVerification";
import { createEmailFeedbackRouter } from "./contactForm/feedback";

export type PublicPluginRouterDeps = {
  upload: Pick<Multer, "none">;
};

interface PublicPluginRouteRegistrationDefinition {
  routeId: string;
  mountPath: string;
  createRouter: (deps: PublicPluginRouterDeps) => express.Router;
}

export interface PublicPluginRouteRegistration {
  routeId: string;
  mountPath: string;
  router: express.Router;
}

const publicPluginRouteDefinitions: PublicPluginRouteRegistrationDefinition[] = [
  {
    routeId: "contact_form.email_feedback",
    mountPath: "",
    createRouter: () => createEmailFeedbackRouter(),
  },
  {
    routeId: "analytics.public",
    mountPath: "/plugins",
    createRouter: (deps) => createAnalyticsPublicRouter(deps),
  },
  {
    routeId: "contact_form.recipient_verification",
    mountPath: "/plugins",
    createRouter: () => createContactRecipientVerificationRouter(),
  },
  {
    routeId: "contact_form.submit",
    mountPath: "/plugins",
    createRouter: (deps) => createContactFormPublicRouter(deps),
  },
];

export function listPublicPluginRouteRegistrations(
  deps: PublicPluginRouterDeps,
): PublicPluginRouteRegistration[] {
  return publicPluginRouteDefinitions.map((definition) => ({
    routeId: definition.routeId,
    mountPath: definition.mountPath,
    router: definition.createRouter(deps),
  }));
}
