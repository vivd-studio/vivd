import { definePluginPackageDescriptors } from "@vivd/shared/types";
import type {
  PluginModule as SharedPluginModule,
  PluginPackageDescriptor,
} from "@vivd/shared/types";
import type express from "express";
import type { Multer } from "multer";
import { analyticsPluginManifest } from "@vivd/plugin-analytics/manifest";
import { contactFormPluginManifest } from "@vivd/plugin-contact-form/manifest";
import { analyticsPluginBackendContribution } from "./analytics/backendContribution";
import { contactFormPluginBackendContribution } from "./contactForm/backendContribution";
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

export const backendPluginPackageDescriptors =
  definePluginPackageDescriptors([
  {
    ...contactFormPluginManifest,
    backend: {
      module: contactFormPluginBackendContribution.module,
      publicRoutes: contactFormPluginBackendContribution.publicRoutes,
      hooks: contactFormPluginBackendContribution.hooks,
    } as BackendPluginContribution<"contact_form">,
  },
  {
    ...analyticsPluginManifest,
    backend: {
      module: analyticsPluginBackendContribution.module,
      publicRoutes: analyticsPluginBackendContribution.publicRoutes,
      hooks: analyticsPluginBackendContribution.hooks,
    } as BackendPluginContribution<"analytics">,
  },
] as const);

export function listBackendPublicPluginRouteDefinitions(): BackendPublicPluginRouteDefinition[] {
  return backendPluginPackageDescriptors.flatMap<BackendPublicPluginRouteDefinition>(
    (descriptor) => [...(descriptor.backend.publicRoutes ?? [])],
  );
}
