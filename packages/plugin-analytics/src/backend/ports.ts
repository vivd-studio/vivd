import type { Multer } from "multer";

export interface AnalyticsPluginInstanceRow {
  id: string;
  organizationId: string;
  projectSlug: string;
  status: string;
  configJson: unknown;
  publicToken: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalyticsResolvedPluginEntitlement {
  state: "disabled" | "enabled" | "suspended";
  scope: "instance" | "organization" | "project" | "none";
  monthlyEventLimit: number | null;
  hardStop: boolean;
}

export interface AnalyticsPluginDatabase {
  select(...args: any[]): any;
  update(table: any): any;
  insert(table: any): any;
}

export interface AnalyticsPluginQueryDatabase extends AnalyticsPluginDatabase {
  query: {
    projectPluginInstance: {
      findFirst(args: any): any;
    };
  };
}

export interface AnalyticsPluginTables {
  analyticsEvent: any;
  contactFormSubmission: any;
  projectPluginInstance: any;
}

export interface AnalyticsPluginInstanceServicePort {
  ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "analytics";
  }): Promise<{ row: AnalyticsPluginInstanceRow; created: boolean }>;
  getPluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "analytics" | "contact_form";
  }): Promise<AnalyticsPluginInstanceRow | null>;
}

export interface AnalyticsPluginEntitlementServicePort {
  resolveEffectiveEntitlement(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: "analytics";
  }): Promise<AnalyticsResolvedPluginEntitlement>;
}

export interface AnalyticsPublicPluginApiResolver {
  (options?: {
    requestHost?: string | null;
  }): Promise<string>;
}

export interface AnalyticsSourceHeaders {
  origin?: string | null;
  referer?: string | null;
}

export interface AnalyticsHostUtilsPort {
  extractSourceHostFromHeaders(
    headers: AnalyticsSourceHeaders,
  ): string | null;
  normalizeHostCandidate(raw: string | null | undefined): string | null;
  isHostAllowed(sourceHost: string | null, allowlist: string[]): boolean;
}

export interface AnalyticsPluginServiceDeps {
  db: AnalyticsPluginDatabase;
  tables: AnalyticsPluginTables;
  pluginEntitlementService: AnalyticsPluginEntitlementServicePort;
  projectPluginInstanceService: AnalyticsPluginInstanceServicePort;
  getPublicPluginApiBaseUrl: AnalyticsPublicPluginApiResolver;
}

export interface AnalyticsPluginUsageCountRow {
  organizationId: string;
  projectSlug: string;
  count: number;
}

export interface AnalyticsPluginIntegrationHooksDeps {
  db: Pick<AnalyticsPluginDatabase, "select">;
  tables: Pick<AnalyticsPluginTables, "analyticsEvent">;
}

export interface AnalyticsPublicRouterDeps {
  upload: Pick<Multer, "none">;
  db: AnalyticsPluginQueryDatabase;
  tables: Pick<AnalyticsPluginTables, "analyticsEvent" | "projectPluginInstance">;
  pluginEntitlementService: AnalyticsPluginEntitlementServicePort;
  getPublicPluginApiBaseUrl: AnalyticsPublicPluginApiResolver;
  inferSourceHosts(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string[]>;
  hostUtils: AnalyticsHostUtilsPort;
}

export interface AnalyticsPluginBackendContributionDeps
  extends Omit<AnalyticsPluginServiceDeps, "db"> {
  db: AnalyticsPluginQueryDatabase;
  inferSourceHosts(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string[]>;
  hostUtils: AnalyticsHostUtilsPort;
}
