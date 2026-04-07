import {
  buildContactFormOrganizationProjectSummaries,
  cleanupContactFormEntitlementFields,
  prepareContactFormEntitlementFields,
  type ContactFormOrganizationInstanceSnapshot,
  type ContactFormProjectEntitlementSnapshot,
} from "@vivd/plugin-contact-form/backend/adminHooks";
import type {
  OrganizationPluginIssue,
  PluginSurfaceBadge,
} from "./surfaceTypes";
import type { PluginEntitlementState } from "./PluginEntitlementService";
import type { PluginId } from "./registry";

export interface OrganizationPluginInstanceSnapshot {
  status: string | null;
  configJson: unknown;
}

export interface OrganizationPluginProjectIntegrationSummary {
  summaryLines: string[];
  badges: PluginSurfaceBadge[];
  issues: OrganizationPluginIssue[];
}

type OrganizationPluginHook = (options: {
  organizationId: string;
  projectSlugs: string[];
  instancesByProjectSlug: Map<string, OrganizationPluginInstanceSnapshot | null>;
}) => Promise<Map<string, OrganizationPluginProjectIntegrationSummary>>;

const organizationPluginHooks: Partial<Record<PluginId, OrganizationPluginHook>> = {
  contact_form: async (options) => {
    const rawSummaries = await buildContactFormOrganizationProjectSummaries({
      organizationId: options.organizationId,
      projectSlugs: options.projectSlugs,
      instancesByProjectSlug:
        options.instancesByProjectSlug as Map<
          string,
          ContactFormOrganizationInstanceSnapshot | null
        >,
    });

    return new Map(
      Array.from(rawSummaries.entries()).map(([projectSlug, summary]) => [
        projectSlug,
        {
          summaryLines: summary.summaryLines,
          badges: summary.badges as PluginSurfaceBadge[],
          issues: summary.issues as OrganizationPluginIssue[],
        },
      ]),
    );
  },
};

export async function buildOrganizationPluginProjectSummaries(options: {
  pluginId: PluginId;
  organizationId: string;
  projectSlugs: string[];
  instancesByProjectSlug: Map<string, OrganizationPluginInstanceSnapshot | null>;
}): Promise<Map<string, OrganizationPluginProjectIntegrationSummary>> {
  const hook = organizationPluginHooks[options.pluginId];
  if (!hook) return new Map();
  return hook(options);
}

export interface SuperAdminPluginEntitlementSnapshot {
  turnstileWidgetId: string | null;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

export interface PreparedPluginEntitlementFields {
  turnstileEnabled: boolean;
  turnstileWidgetId: string | null;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

interface SuperAdminEntitlementHook {
  prepareProjectEntitlementFields(options: {
    organizationId: string;
    projectSlug: string;
    state: PluginEntitlementState;
    turnstileEnabled: boolean;
    existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
  }): Promise<PreparedPluginEntitlementFields>;
  cleanupProjectEntitlementFields(options: {
    state: PluginEntitlementState;
    turnstileEnabled: boolean;
    existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
  }): Promise<void>;
}

const superAdminEntitlementHooks: Partial<Record<PluginId, SuperAdminEntitlementHook>> = {
  contact_form: {
    prepareProjectEntitlementFields(options) {
      return prepareContactFormEntitlementFields({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        state: options.state,
        turnstileEnabled: options.turnstileEnabled,
        existingProjectEntitlement:
          options.existingProjectEntitlement as ContactFormProjectEntitlementSnapshot | null,
      });
    },
    cleanupProjectEntitlementFields(options) {
      return cleanupContactFormEntitlementFields({
        state: options.state,
        turnstileEnabled: options.turnstileEnabled,
        existingProjectEntitlement:
          options.existingProjectEntitlement as ContactFormProjectEntitlementSnapshot | null,
      });
    },
  },
};

export async function preparePluginProjectEntitlementFields(options: {
  pluginId: PluginId;
  organizationId: string;
  projectSlug: string;
  state: PluginEntitlementState;
  turnstileEnabled: boolean;
  existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
}): Promise<PreparedPluginEntitlementFields> {
  const hook = superAdminEntitlementHooks[options.pluginId];
  if (!hook) {
    return {
      turnstileEnabled: options.turnstileEnabled,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
    };
  }

  return hook.prepareProjectEntitlementFields(options);
}

export async function cleanupPluginProjectEntitlementFields(options: {
  pluginId: PluginId;
  state: PluginEntitlementState;
  turnstileEnabled: boolean;
  existingProjectEntitlement: SuperAdminPluginEntitlementSnapshot | null;
}): Promise<void> {
  const hook = superAdminEntitlementHooks[options.pluginId];
  if (!hook) return;
  await hook.cleanupProjectEntitlementFields(options);
}
