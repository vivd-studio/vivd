import type express from "express";
import type { Multer } from "multer";
import type {
  ContactRecipientDirectory,
  ContactRecipientVerificationRequestResult,
} from "./module";

export interface ContactFormPluginInstanceRow {
  id: string;
  organizationId: string;
  projectSlug: string;
  status: string;
  configJson: unknown;
  publicToken: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactFormResolvedPluginEntitlement {
  state: "disabled" | "enabled" | "suspended";
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

export interface ContactFormPluginInstanceServicePort {
  ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "contact_form";
  }): Promise<{ row: ContactFormPluginInstanceRow; created: boolean }>;
  getPluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "contact_form";
  }): Promise<ContactFormPluginInstanceRow | null>;
  updatePluginInstance(options: {
    instanceId: string;
    configJson?: unknown;
    status?: string;
    updatedAt?: Date;
  }): Promise<ContactFormPluginInstanceRow | null>;
}

export interface ContactFormPluginEntitlementServicePort {
  resolveEffectiveEntitlement(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "contact_form";
  }): Promise<ContactFormResolvedPluginEntitlement>;
}

export interface ContactFormRecipientVerificationServicePort {
  listRecipientDirectory(options: {
    organizationId: string;
    projectSlug: string;
    verifiedRecipientEmails: string[];
  }): Promise<ContactRecipientDirectory>;
  listVerifiedExternalRecipientEmailSet(options: {
    organizationId: string;
    projectSlug: string;
    recipientEmails: string[];
  }): Promise<Set<string>>;
  requestRecipientVerification(options: {
    organizationId: string;
    projectSlug: string;
    pluginInstanceId: string;
    email: string;
    requestedByUserId?: string | null;
    requestHost?: string | null;
  }): Promise<ContactRecipientVerificationRequestResult>;
  markRecipientVerified(options: {
    organizationId: string;
    projectSlug: string;
    pluginInstanceId: string;
    email: string;
    requestedByUserId?: string | null;
  }): Promise<ContactRecipientVerificationRequestResult>;
}

export interface ContactFormSubmitEndpointResolver {
  (options?: {
    requestHost?: string | null;
  }): Promise<string>;
}

export interface ContactFormPluginServiceDeps {
  projectPluginInstanceService: ContactFormPluginInstanceServicePort;
  pluginEntitlementService: ContactFormPluginEntitlementServicePort;
  recipientVerificationService: ContactFormRecipientVerificationServicePort;
  getContactFormSubmitEndpoint: ContactFormSubmitEndpointResolver;
  inferSourceHosts(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string[]>;
  listVerifiedOrganizationMemberEmails(options: {
    organizationId: string;
  }): Promise<string[]>;
}

export interface ContactFormBackendRouteDeps {
  upload: Pick<Multer, "none">;
}

export interface ContactFormPluginBackendContributionDeps
  extends ContactFormPluginServiceDeps {}

export interface ContactFormBackendRouteDefinition {
  routeId: string;
  mountPath: string;
  createRouter: (deps: ContactFormBackendRouteDeps) => express.Router;
}
