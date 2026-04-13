import type express from "express";
import type { Multer } from "multer";
import type {
  NewsletterSubscribersPayload,
  NewsletterSummaryPayload,
} from "../shared/summary";

export interface NewsletterPluginInstanceRow {
  id: string;
  organizationId: string;
  projectSlug: string;
  status: string;
  configJson: unknown;
  publicToken: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewsletterResolvedPluginEntitlement {
  state: "disabled" | "enabled" | "suspended";
  scope: "instance" | "organization" | "project" | "none";
  monthlyEventLimit: number | null;
  hardStop: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

export interface NewsletterPluginDatabase {
  query: Record<string, any>;
  select(...args: any[]): any;
  insert(table: any): any;
  update(table: any): any;
  delete(table: any): any;
  transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
}

export interface NewsletterPluginTables {
  newsletterSubscriber: any;
  newsletterActionToken: any;
  projectMeta: any;
  projectPluginInstance: any;
}

export interface NewsletterPluginInstanceServicePort {
  ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "newsletter";
  }): Promise<{ row: NewsletterPluginInstanceRow; created: boolean }>;
  getPluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "newsletter";
  }): Promise<NewsletterPluginInstanceRow | null>;
  updatePluginInstance(options: {
    instanceId: string;
    configJson?: unknown;
    status?: string;
    updatedAt?: Date;
  }): Promise<NewsletterPluginInstanceRow | null>;
}

export interface NewsletterPluginEntitlementServicePort {
  resolveEffectiveEntitlement(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "newsletter";
  }): Promise<NewsletterResolvedPluginEntitlement>;
}

export interface NewsletterPublicPluginApiResolver {
  (options?: {
    requestHost?: string | null;
  }): Promise<string>;
}

export interface NewsletterSourceHeaders {
  origin?: string | null;
  referer?: string | null;
}

export interface NewsletterHostUtilsPort {
  extractSourceHostFromHeaders(
    headers: NewsletterSourceHeaders,
  ): string | null;
  isHostAllowed(sourceHost: string | null, allowlist: string[]): boolean;
  normalizeHostCandidate(raw: string | null | undefined): string | null;
}

export interface NewsletterEmailDeliveryServicePort {
  send(options: {
    to: string[];
    subject: string;
    text?: string;
    html?: string;
    metadata?: Record<string, string>;
  }): Promise<{
    accepted: boolean;
    provider: string;
    error?: string | null;
  }>;
}

export interface NewsletterEmailTemplatesPort {
  buildConfirmationEmail(options: {
    projectTitle: string;
    recipientName?: string | null;
    confirmUrl: string;
    unsubscribeUrl: string;
    expiresInSeconds: number;
    mode: "newsletter" | "waitlist";
  }): Promise<{
    subject: string;
    text: string;
    html: string;
  }>;
}

export interface NewsletterPluginServiceDeps {
  db: NewsletterPluginDatabase;
  tables: NewsletterPluginTables;
  pluginEntitlementService: NewsletterPluginEntitlementServicePort;
  projectPluginInstanceService: NewsletterPluginInstanceServicePort;
  getPublicPluginApiBaseUrl: NewsletterPublicPluginApiResolver;
  inferSourceHosts(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string[]>;
  hostUtils: NewsletterHostUtilsPort;
  emailDeliveryService: NewsletterEmailDeliveryServicePort;
  emailTemplates: NewsletterEmailTemplatesPort;
}

export interface NewsletterPluginIntegrationHooksDeps {
  db: NewsletterPluginDatabase;
  tables: Pick<NewsletterPluginTables, "newsletterSubscriber">;
}

export interface NewsletterSubscribeInput {
  organizationId: string;
  projectSlug: string;
  token: string;
  email: string;
  name?: string | null;
  sourceHost: string | null;
  referer: string | null;
  origin: string | null;
  redirect: string | null;
  clientIp: string | null;
  turnstileToken?: string | null;
}

export interface NewsletterSubscriberMutationResult {
  email: string;
  status:
    | "pending"
    | "pending_cooldown"
    | "already_confirmed"
    | "confirmed"
    | "unsubscribed"
    | "already_unsubscribed";
}

export interface NewsletterConfirmByTokenResult {
  status: "confirmed" | "already_confirmed" | "invalid" | "expired";
  projectSlug?: string;
  redirectTarget?: string | null;
}

export interface NewsletterUnsubscribeByTokenResult {
  status:
    | "unsubscribed"
    | "already_unsubscribed"
    | "invalid"
    | "expired";
  projectSlug?: string;
  redirectTarget?: string | null;
}

export interface NewsletterBackendRouteDefinition {
  routeId: string;
  mountPath: string;
  createRouter: (deps: {
    upload: Pick<Multer, "none">;
  }) => express.Router;
}

export interface NewsletterPublicRouterDeps {
  upload: Pick<Multer, "none">;
  service: {
    subscribe(options: NewsletterSubscribeInput): Promise<{
      redirectTarget: string | null;
      result: NewsletterSubscriberMutationResult;
    }>;
    confirmByToken(options: {
      token: string;
      redirect: string | null;
    }): Promise<NewsletterConfirmByTokenResult>;
    unsubscribeByToken(options: {
      token: string;
      redirect: string | null;
    }): Promise<NewsletterUnsubscribeByTokenResult>;
  };
}

export interface NewsletterPluginServicePort {
  ensureNewsletterPlugin(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<{
    pluginId: "newsletter";
    instanceId: string;
    status: string;
    created: boolean;
    publicToken: string;
    config: Record<string, unknown>;
    snippets: {
      html: string;
      astro: string;
    };
  }>;
  getNewsletterInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<any>;
  updateNewsletterConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: Record<string, unknown>;
  }): Promise<any>;
  getNewsletterSummary(options: {
    organizationId: string;
    projectSlug: string;
    rangeDays: 7 | 30;
  }): Promise<NewsletterSummaryPayload>;
  listSubscribers(options: {
    organizationId: string;
    projectSlug: string;
    status: "all" | "pending" | "confirmed" | "unsubscribed" | "bounced" | "complained";
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<NewsletterSubscribersPayload>;
}
