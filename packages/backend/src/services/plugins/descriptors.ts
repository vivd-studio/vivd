import {
  installedBackendPluginPackages,
} from "@vivd/installed-plugins/backend";
import { definePluginPackageDescriptors } from "@vivd/plugin-sdk";
import type {
  PluginModule as SharedPluginModule,
  PluginPackageDescriptor,
  PluginStopFn,
} from "@vivd/plugin-sdk";
import type express from "express";
import type { Multer } from "multer";
import { analyticsPluginBackendContribution } from "./analytics/backendContribution";
import { contactFormPluginBackendContribution } from "./contactForm/backendContribution";
import { newsletterPluginBackendContribution } from "./newsletter/backendContribution";
import type { PluginEntitlementState } from "./PluginEntitlementService";
import type {
  OrganizationPluginIssue,
  PluginSurfaceBadge,
} from "./surfaceTypes";

export interface BackendPluginIntegrationOrganizationSummary {
  summaryLines: string[];
  badges: PluginSurfaceBadge[];
  issues: OrganizationPluginIssue[];
}

export interface BackendPluginIntegrationOrganizationHook {
  (options: {
    organizationId: string;
    projectSlugs: string[];
    instancesByProjectSlug: Map<string, { status: string | null; configJson: unknown } | null>;
  }): Promise<Map<string, BackendPluginIntegrationOrganizationSummary>>;
}

export interface BackendPluginPreparedEntitlementFields {
  turnstileEnabled: boolean;
  turnstileWidgetId: string | null;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

export interface BackendPluginProjectUsageCount {
  organizationId: string;
  projectSlug: string;
  count: number;
}

export interface BackendPluginIntegrationHooks {
  listProjectUsageCounts?: (options: {
    organizationId?: string;
    startedAt: Date;
  }) => Promise<BackendPluginProjectUsageCount[]>;
  buildOrganizationProjectSummaries?: BackendPluginIntegrationOrganizationHook;
  prepareProjectEntitlementFields?: (options: {
    organizationId: string;
    projectSlug: string;
    state: PluginEntitlementState;
    turnstileEnabled: boolean;
    existingProjectEntitlement: {
      turnstileWidgetId: string | null;
      turnstileSiteKey: string | null;
      turnstileSecretKey: string | null;
    } | null;
  }) => Promise<BackendPluginPreparedEntitlementFields>;
  cleanupProjectEntitlementFields?: (options: {
    state: PluginEntitlementState;
    turnstileEnabled: boolean;
    existingProjectEntitlement: {
      turnstileWidgetId: string | null;
      turnstileSiteKey: string | null;
      turnstileSecretKey: string | null;
    } | null;
  }) => Promise<void>;
  renameProjectSlugData?: (options: {
    tx: {
      update(table: any): any;
    };
    organizationId: string;
    oldSlug: string;
    newSlug: string;
  }) => Promise<number>;
  startBackgroundJobs?: () =>
    | void
    | PluginStopFn
    | readonly PluginStopFn[];
}

export type PublicPluginRouterDeps = {
  upload: Pick<Multer, "none">;
};

export interface BackendPublicPluginRouteDefinition {
  routeId: string;
  mountPath: string;
  createRouter: (deps: PublicPluginRouterDeps) => express.Router;
}

export interface BackendPluginContribution<
  TPluginId extends string = string,
> {
  module: SharedPluginModule<TPluginId>;
  publicRoutes?: readonly BackendPublicPluginRouteDefinition[];
  hooks?: BackendPluginIntegrationHooks;
}

export interface BackendPluginPackageDescriptor
  extends PluginPackageDescriptor<
    string,
    never,
    BackendPluginContribution<string>
  > {
  backend: BackendPluginContribution<string>;
}

type InstalledBackendPluginId =
  (typeof installedBackendPluginPackages)[number]["pluginId"];

const backendPluginContributionsById = {
  contact_form: contactFormPluginBackendContribution,
  analytics: analyticsPluginBackendContribution,
  newsletter: newsletterPluginBackendContribution,
} as const satisfies Record<
  InstalledBackendPluginId,
  BackendPluginContribution<string>
>;

export const backendPluginPackageDescriptors =
  definePluginPackageDescriptors([
    ...installedBackendPluginPackages.map((pluginPackage) => ({
      ...pluginPackage,
      backend: backendPluginContributionsById[pluginPackage.pluginId],
    })),
  ] as const satisfies readonly BackendPluginPackageDescriptor[]);

export function listBackendPublicPluginRouteDefinitions(): BackendPublicPluginRouteDefinition[] {
  return backendPluginPackageDescriptors.flatMap<BackendPublicPluginRouteDefinition>(
    (descriptor) => [...(descriptor.backend.publicRoutes ?? [])],
  );
}
