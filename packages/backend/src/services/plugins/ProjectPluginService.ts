import {
  contactFormPluginService,
  type ContactFormPluginInfoPayload,
  type ContactFormPluginPayload,
} from "./contactForm/service";
import type { ContactFormPluginConfig } from "./contactForm/config";
import type { ContactRecipientVerificationRequestResult } from "./contactForm/recipientVerification";
import {
  analyticsPluginService,
  type AnalyticsPluginInfoPayload,
  type AnalyticsPluginPayload,
  type AnalyticsSummaryPayload,
} from "./analytics/service";
import type { AnalyticsPluginConfig } from "./analytics/config";
import {
  projectPluginInstanceService,
  type ProjectPluginInstanceSummary,
} from "./core/instanceService";
import { pluginEntitlementService } from "./PluginEntitlementService";
import {
  derivePluginInstallState,
  type ProjectPluginCatalogItem,
} from "./surfaceTypes";
import {
  listPluginCatalogEntries,
  type PluginCatalogEntry,
  type PluginId,
} from "./registry";

export interface PluginCatalogForProject {
  project: {
    organizationId: string;
    slug: string;
  };
  plugins: ProjectPluginCatalogItem[];
  available: PluginCatalogEntry[];
  instances: ProjectPluginInstanceSummary[];
}

class ProjectPluginService {
  async listCatalogForProject(
    organizationId: string,
    projectSlug: string,
  ): Promise<PluginCatalogForProject> {
    const rows = await projectPluginInstanceService.listProjectPluginInstances({
      organizationId,
      projectSlug,
    });
    const byPluginId = new Map(rows.map((row) => [row.pluginId as PluginId, row]));
    const available = listPluginCatalogEntries();
    const plugins = await Promise.all(
      available.map(async (catalog) => {
        const instance = byPluginId.get(catalog.pluginId);
        const entitlement = await pluginEntitlementService.resolveEffectiveEntitlement({
          organizationId,
          projectSlug,
          pluginId: catalog.pluginId,
        });

        return {
          pluginId: catalog.pluginId,
          catalog,
          installState: derivePluginInstallState({
            entitlementState: entitlement.state,
            instanceStatus: instance?.status ?? null,
          }),
          entitled: entitlement.state === "enabled",
          entitlementState: entitlement.state,
          instanceId: instance?.id ?? null,
          instanceStatus: instance?.status ?? null,
          updatedAt: instance?.updatedAt?.toISOString() ?? entitlement.updatedAt?.toISOString() ?? null,
        } satisfies ProjectPluginCatalogItem;
      }),
    );

    return {
      project: {
        organizationId,
        slug: projectSlug,
      },
      plugins,
      available,
      instances: rows.map((row) => projectPluginInstanceService.toSummary(row)),
    };
  }

  async ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<{ instanceId: string; created: boolean; status: string }> {
    if (options.pluginId === "contact_form") {
      const result = await this.ensureContactFormPlugin(options);
      return {
        instanceId: result.instanceId,
        created: result.created,
        status: result.status,
      };
    }

    if (options.pluginId === "analytics") {
      const result = await this.ensureAnalyticsPlugin(options);
      return {
        instanceId: result.instanceId,
        created: result.created,
        status: result.status,
      };
    }

    const { row, created } = await projectPluginInstanceService.ensurePluginInstance(
      options,
    );
    return {
      instanceId: row.id,
      created,
      status: row.status,
    };
  }

  async ensureContactFormPlugin(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ContactFormPluginPayload> {
    return contactFormPluginService.ensureContactFormPlugin(options);
  }

  async ensureAnalyticsPlugin(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<AnalyticsPluginPayload> {
    return analyticsPluginService.ensureAnalyticsPlugin(options);
  }

  async getContactFormPlugin(options: {
    organizationId: string;
    projectSlug: string;
    ensure?: boolean;
  }): Promise<ContactFormPluginPayload | null> {
    return contactFormPluginService.getContactFormPlugin(options);
  }

  async getAnalyticsPlugin(options: {
    organizationId: string;
    projectSlug: string;
    ensure?: boolean;
  }): Promise<AnalyticsPluginPayload | null> {
    return analyticsPluginService.getAnalyticsPlugin(options);
  }

  async updateContactFormConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: ContactFormPluginConfig;
  }): Promise<ContactFormPluginPayload> {
    return contactFormPluginService.updateContactFormConfig(options);
  }

  async updateAnalyticsConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: AnalyticsPluginConfig;
  }): Promise<AnalyticsPluginPayload> {
    return analyticsPluginService.updateAnalyticsConfig(options);
  }

  async getContactFormInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ContactFormPluginInfoPayload> {
    return contactFormPluginService.getContactFormInfo(options);
  }

  async requestContactRecipientVerification(options: {
    organizationId: string;
    projectSlug: string;
    email: string;
    requestedByUserId?: string | null;
    requestHost?: string | null;
  }): Promise<ContactRecipientVerificationRequestResult> {
    return contactFormPluginService.requestRecipientVerification(options);
  }

  async getAnalyticsInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<AnalyticsPluginInfoPayload> {
    return analyticsPluginService.getAnalyticsInfo(options);
  }

  async getAnalyticsSummary(options: {
    organizationId: string;
    projectSlug: string;
    rangeDays: 7 | 30;
  }): Promise<AnalyticsSummaryPayload> {
    return analyticsPluginService.getAnalyticsSummary(options);
  }
}

export const projectPluginService = new ProjectPluginService();
export type {
  ContactFormPluginInfoPayload,
  ContactFormPluginPayload,
  AnalyticsPluginInfoPayload,
  AnalyticsPluginPayload,
  AnalyticsSummaryPayload,
  ProjectPluginInstanceSummary,
};
