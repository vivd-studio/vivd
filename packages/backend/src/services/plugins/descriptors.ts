import { definePluginPackageDescriptors } from "@vivd/plugin-sdk";
import type {
  PluginContribution as SharedPluginContribution,
  PluginPackageDescriptor,
  PluginRouteDefinition as SharedPluginRouteDefinition,
  PluginStopFn,
} from "@vivd/plugin-sdk";
import { installedBackendPluginPackages } from "@vivd/installed-plugins/backend";
import type express from "express";
import type { Multer } from "multer";
import { backendPluginHostContext } from "./hostContext";
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

export interface BackendPublicPluginRouteDefinition
  extends SharedPluginRouteDefinition<express.Router, PublicPluginRouterDeps> {}

export interface BackendPluginContribution<
  TPluginId extends string = string,
> extends SharedPluginContribution<
    TPluginId,
    BackendPluginIntegrationHooks,
    BackendPublicPluginRouteDefinition
  > {}

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
    ...installedBackendPluginPackages.flatMap((pluginPackage) => {
      const contribution =
        pluginPackage.backend?.createHostContribution?.(
          backendPluginHostContext,
        ) ?? null;
      if (!contribution) return [];

      return [
        {
          ...pluginPackage,
          backend: contribution,
        },
      ];
    }),
  ] as const satisfies readonly BackendPluginPackageDescriptor[]);

export function listBackendPublicPluginRouteDefinitions(): BackendPublicPluginRouteDefinition[] {
  return backendPluginPackageDescriptors.flatMap<BackendPublicPluginRouteDefinition>(
    (descriptor) => [...(descriptor.backend.publicRoutes ?? [])],
  );
}
