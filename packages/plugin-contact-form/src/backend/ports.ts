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
  scope: "instance" | "organization" | "project" | "none";
  monthlyEventLimit: number | null;
  hardStop: boolean;
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
  verifyRecipientByToken(token: string): Promise<
    | {
        status: "verified";
        email: string;
        projectSlug: string;
      }
    | {
        status: "invalid" | "expired";
      }
  >;
}

export interface ContactFormSubmitEndpointResolver {
  (options?: {
    requestHost?: string | null;
  }): Promise<string>;
}

export interface ContactFormRecipientVerificationEndpointResolver {
  (options?: {
    requestHost?: string | null;
  }): string;
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

export interface ContactFormRecipientVerificationDatabase {
  select(...args: any[]): any;
  query: {
    projectPluginInstance: {
      findFirst(args: any): Promise<any>;
    };
    organizationMember: {
      findMany(args: any): Promise<any[]>;
    };
    contactFormRecipientVerification: {
      findFirst(args: any): Promise<any>;
      findMany(args: any): Promise<any[]>;
    };
  };
  update(table: any): any;
  insert(table: any): any;
  delete(table: any): any;
  transaction(callback: (tx: any) => Promise<void>): Promise<void>;
}

export interface ContactFormRecipientVerificationTables {
  contactFormRecipientVerification: any;
  organizationMember: any;
  projectPluginInstance: any;
}

export interface ContactFormRecipientVerificationEmailPayload {
  subject: string;
  text: string;
  html: string;
}

export interface ContactFormRecipientVerificationEmailSender {
  send(options: {
    to: string[];
    subject: string;
    text: string;
    html: string;
    metadata: {
      category: string;
      plugin: string;
      organization: string;
      project: string;
    };
  }): Promise<{
    accepted: boolean;
    provider: string;
    error?: string | null;
  }>;
}

export interface ContactFormRecipientVerificationServiceDeps {
  db: ContactFormRecipientVerificationDatabase;
  tables: ContactFormRecipientVerificationTables;
  getContactRecipientVerificationEndpoint: ContactFormRecipientVerificationEndpointResolver;
  buildRecipientVerificationEmail(options: {
    projectSlug: string;
    verificationUrl: string;
    expiresInSeconds: number;
  }): Promise<ContactFormRecipientVerificationEmailPayload>;
  emailDeliveryService: ContactFormRecipientVerificationEmailSender;
}

export interface ContactFormBackendRouteDeps {
  upload: Pick<Multer, "none">;
}

export interface ContactFormPluginBackendContributionDeps
  extends ContactFormPluginServiceDeps {
  recipientVerificationService: ContactFormRecipientVerificationServicePort;
  turnstileService: ContactFormTurnstileServicePort;
  emailDeliverabilityService: ContactFormEmailDeliverabilityServicePort;
  emailDeliveryService: ContactFormSubmissionEmailSender;
  buildContactSubmissionEmail(options: {
    projectSlug: string;
    submittedAtLabel: string;
    replyToEmail: string | null;
    submittedFields: Array<{
      label: string;
      value: string;
    }>;
    unknownFields: Record<string, string>;
  }): Promise<{
    text: string;
    html: string;
  }>;
  isSesFeedbackAutoConfirmEnabled(): boolean;
  db: ContactFormPublicRouterDatabase;
  tables: ContactFormPluginBackendTables;
}

export interface ContactFormBackendRouteDefinition {
  routeId: string;
  mountPath: string;
  createRouter: (deps: ContactFormBackendRouteDeps) => express.Router;
}

export interface ContactRecipientVerificationRouterDeps {
  recipientVerificationService: Pick<
    ContactFormRecipientVerificationServicePort,
    "verifyRecipientByToken"
  >;
}

export interface ContactFormTurnstileWidgetCredentials {
  widgetId: string;
  siteKey: string;
  secretKey: string;
  domains: string[];
}

export interface ContactFormTurnstileVerificationResult {
  success: boolean;
  errorCodes: string[];
  hostname: string | null;
  action: string | null;
  cdata: string | null;
}

export interface ContactFormTurnstileDatabase {
  query: {
    projectMeta: {
      findFirst(args: any): Promise<any>;
    };
    projectPluginInstance: {
      findFirst(args: any): Promise<any>;
    };
    pluginEntitlement: {
      findMany(args: any): Promise<any[]>;
    };
  };
  update(table: any): any;
}

export interface ContactFormTurnstileTables {
  pluginEntitlement: any;
  projectMeta: any;
  projectPluginInstance: any;
}

export interface ContactFormTurnstileServiceDeps {
  db: ContactFormTurnstileDatabase;
  tables: ContactFormTurnstileTables;
  inferSourceHosts(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string[]>;
}

export interface ContactFormTurnstileServicePort {
  getAutomationConfigurationIssue(): string | null;
  isAutomationConfigured(): boolean;
  getSyncIntervalMs(): number;
  verifyToken(options: {
    secretKey: string;
    token: string;
    remoteIp: string | null;
  }): Promise<ContactFormTurnstileVerificationResult>;
  prepareProjectWidgetCredentials(options: {
    organizationId: string;
    projectSlug: string;
    existingWidgetId?: string | null;
    existingSiteKey?: string | null;
    existingSecretKey?: string | null;
  }): Promise<ContactFormTurnstileWidgetCredentials>;
  deleteWidget(widgetId: string): Promise<void>;
  syncAllProjectEntitlements(): Promise<{
    synced: number;
    cleaned: number;
    failed: number;
  }>;
}

export interface ContactFormRetentionDatabase {
  delete(table: any): any;
}

export interface ContactFormRetentionTables {
  contactFormSubmission: any;
}

export interface ContactFormRetentionDeps {
  db: ContactFormRetentionDatabase;
  tables: ContactFormRetentionTables;
}

export interface ContactFormAdminHooksDatabase {
  select(...args: any[]): any;
  query: {
    pluginEntitlement: {
      findMany(args: any): Promise<any[]>;
    };
  };
}

export interface ContactFormAdminHooksTables {
  contactFormRecipientVerification: any;
  pluginEntitlement: any;
}

export interface ContactFormAdminHooksDeps {
  db: ContactFormAdminHooksDatabase;
  tables: ContactFormAdminHooksTables;
  turnstileService: Pick<
    ContactFormTurnstileServicePort,
    | "getAutomationConfigurationIssue"
    | "prepareProjectWidgetCredentials"
    | "deleteWidget"
  >;
}

export type ContactFormEmailFeedbackType = "bounce" | "complaint";
export type ContactFormEmailFeedbackSource = "provider_webhook" | "manual";

export interface ContactFormSuppressedRecipientRecord {
  email: string;
  reason: ContactFormEmailFeedbackType;
  source: ContactFormEmailFeedbackSource;
  provider: string;
  firstRecordedAt: string;
  lastRecordedAt: string;
  eventCount: number;
  lastOrganizationId: string | null;
  lastProjectSlug: string | null;
  lastFlow: string | null;
}

export interface ContactFormEmailDeliverabilityServicePort {
  filterSuppressedRecipients(options: {
    recipientEmails: string[];
  }): Promise<{
    deliverableRecipients: string[];
    suppressedRecipients: ContactFormSuppressedRecipientRecord[];
  }>;
  recordFeedback(options: {
    type: ContactFormEmailFeedbackType;
    recipientEmails: string[];
    provider: string;
    source?: ContactFormEmailFeedbackSource;
    occurredAt?: string;
    organizationId?: string | null;
    projectSlug?: string | null;
    flow?: string | null;
  }): Promise<{
    appliedRecipientCount: number;
    summary: {
      metrics: {
        suppressedRecipientCount: number;
      };
    };
  }>;
}

export interface ContactFormSubmissionEmailSender {
  send(options: {
    to: string[];
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
    metadata: {
      plugin: string;
      project: string;
      organization: string;
    };
  }): Promise<{
    accepted: boolean;
    provider: string;
    error?: string | null;
  }>;
}

export interface ContactFormPublicRouterDatabase {
  query: {
    projectPluginInstance: {
      findFirst(args: any): Promise<any>;
    };
  };
  select(...args: any[]): any;
  insert(table: any): any;
}

export interface ContactFormPublicRouterTables {
  contactFormSubmission: any;
  projectPluginInstance: any;
}

export interface ContactFormPluginBackendTables
  extends ContactFormTurnstileTables,
    ContactFormRetentionTables,
    ContactFormAdminHooksTables,
    ContactFormPublicRouterTables,
    ContactFormRecipientVerificationTables {}

export interface ContactFormPublicRouterDeps {
  upload: Pick<Multer, "none">;
  db: ContactFormPublicRouterDatabase;
  tables: ContactFormPublicRouterTables;
  pluginEntitlementService: ContactFormPluginEntitlementServicePort;
  inferSourceHosts(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string[]>;
  turnstileService: Pick<ContactFormTurnstileServicePort, "verifyToken">;
  buildContactSubmissionEmail: ContactFormPluginBackendContributionDeps["buildContactSubmissionEmail"];
  emailDeliveryService: ContactFormSubmissionEmailSender;
  emailDeliverabilityService: Pick<
    ContactFormEmailDeliverabilityServicePort,
    "filterSuppressedRecipients"
  >;
}

export interface ContactFormFeedbackRouterDeps {
  emailDeliverabilityService: Pick<
    ContactFormEmailDeliverabilityServicePort,
    "recordFeedback"
  >;
  isSesFeedbackAutoConfirmEnabled(): boolean;
}
