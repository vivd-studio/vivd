import type { PluginPackageDescriptor } from "@vivd/shared/types";
import { analyticsPluginDescriptor } from "@vivd/plugin-analytics/descriptor";
import { contactFormPluginDescriptor } from "@vivd/plugin-contact-form/descriptor";
import { contactFormPluginBackendHooks } from "@vivd/plugin-contact-form/backendHooks";
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

export interface BackendPluginIntegrationHooks {
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

export interface BackendPluginPackageDescriptor
  extends PluginPackageDescriptor<string, never, BackendPluginIntegrationHooks> {}

function defineBackendPluginPackageDescriptors<
  const T extends readonly BackendPluginPackageDescriptor[],
>(
  descriptors: T,
) {
  return descriptors;
}

type PluginIdsFromDescriptors<T extends readonly { pluginId: string }[]> = {
  [K in keyof T]: T[K] extends { pluginId: infer TPluginId extends string }
    ? TPluginId
    : never;
};

export function extractPluginIds<const T extends readonly { pluginId: string }[]>(
  descriptors: T,
): PluginIdsFromDescriptors<T> {
  return descriptors.map((descriptor) => descriptor.pluginId) as PluginIdsFromDescriptors<T>;
}

export const backendPluginPackageDescriptors =
  defineBackendPluginPackageDescriptors([
  {
    ...contactFormPluginDescriptor,
    backendHooks: contactFormPluginBackendHooks,
  },
  {
    ...analyticsPluginDescriptor,
    backendHooks: undefined,
  },
] as const);
