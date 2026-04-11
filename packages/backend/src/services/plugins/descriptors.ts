import { definePluginPackageDescriptors } from "@vivd/shared/types";
import type {
  PluginModule as SharedPluginModule,
  PluginPackageDescriptor,
} from "@vivd/shared/types";
import type express from "express";
import type { Multer } from "multer";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";
import { analyticsPluginPublicRoutes } from "./analytics/backendContribution";
import { analyticsPluginBackendHooks } from "./analytics/backendHooks";
import {
  contactFormPluginModule,
  contactFormPluginPublicRoutes,
} from "./contactForm/backendContribution";
import { contactFormPluginBackendHooks } from "./contactForm/backendHooks";
import { analyticsPluginModule } from "./analytics/module";
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
    ...contactFormPluginDescriptor,
    backend: {
      module: contactFormPluginModule,
      publicRoutes: contactFormPluginPublicRoutes,
      hooks: contactFormPluginBackendHooks,
    } as BackendPluginContribution<"contact_form">,
  },
  {
    ...analyticsPluginDescriptor,
    backend: {
      module: analyticsPluginModule,
      publicRoutes: analyticsPluginPublicRoutes,
      hooks: analyticsPluginBackendHooks,
    } as BackendPluginContribution<"analytics">,
  },
] as const);

export function listBackendPublicPluginRouteDefinitions(): BackendPublicPluginRouteDefinition[] {
  return backendPluginPackageDescriptors.flatMap<BackendPublicPluginRouteDefinition>(
    (descriptor) => [...(descriptor.backend.publicRoutes ?? [])],
  );
}
