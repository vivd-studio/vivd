import {
  contactFormPluginService,
  type ContactFormPluginInfoPayload,
  type ContactFormPluginPayload,
} from "./contactForm/service";
import type { ContactFormPluginConfig } from "./contactForm/config";
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

  async getContactFormPlugin(options: {
    organizationId: string;
    projectSlug: string;
    ensure?: boolean;
  }): Promise<ContactFormPluginPayload | null> {
    return contactFormPluginService.getContactFormPlugin(options);
  }

  async updateContactFormConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: ContactFormPluginConfig;
  }): Promise<ContactFormPluginPayload> {
    return contactFormPluginService.updateContactFormConfig(options);
  }

  async getContactFormInfo(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ContactFormPluginInfoPayload> {
    return contactFormPluginService.getContactFormInfo(options);
  }
}

export const projectPluginService = new ProjectPluginService();
export type {
  ContactFormPluginInfoPayload,
  ContactFormPluginPayload,
  ProjectPluginInstanceSummary,
};
