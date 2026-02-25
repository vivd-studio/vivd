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
import { listPluginCatalogEntries, type PluginCatalogEntry } from "./registry";

export interface PluginCatalogForProject {
  project: {
    organizationId: string;
    slug: string;
  };
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

    return {
      project: {
        organizationId,
        slug: projectSlug,
      },
      available: listPluginCatalogEntries(),
      instances: rows.map((row) => projectPluginInstanceService.toSummary(row)),
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
