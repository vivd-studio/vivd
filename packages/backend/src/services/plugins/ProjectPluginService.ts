import {
  ContactFormPluginNotEnabledError,
  ContactFormRecipientRequiredError,
  ContactFormRecipientVerificationError,
  type ContactFormPluginInfoPayload,
  type ContactFormPluginPayload,
} from "./contactForm/service";
import {
  analyticsPluginService,
  type AnalyticsPluginInfoPayload,
  type AnalyticsPluginPayload,
  type AnalyticsSummaryPayload,
} from "./analytics/service";
import {
  projectPluginInstanceService,
  type ProjectPluginInstanceSummary,
} from "./core/instanceService";
import {
  buildPluginInfoContractPayload,
  PluginActionArgumentError,
  type ProjectPluginActionPayload,
  type ProjectPluginInfoContractPayload,
  UnsupportedPluginActionError,
} from "./core/module";
import { pluginEntitlementService } from "./PluginEntitlementService";
import {
  derivePluginInstallState,
  type ProjectPluginCatalogItem,
} from "./surfaceTypes";
import {
  getPluginModule,
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
    return getPluginModule(options.pluginId).ensureInstance(options);
  }

  async getPluginInfoContract(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<ProjectPluginInfoContractPayload> {
    const module = getPluginModule(options.pluginId);
    return buildPluginInfoContractPayload(
      module.definition,
      await module.getInfoPayload(options),
    );
  }

  async updatePluginConfigById(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
    config: Record<string, unknown>;
  }): Promise<ProjectPluginInfoContractPayload> {
    const module = getPluginModule(options.pluginId);
    return buildPluginInfoContractPayload(
      module.definition,
      await module.updateConfig(options),
    );
  }

  async runPluginAction(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
    actionId: string;
    args: string[];
    requestedByUserId?: string | null;
    requestHost?: string | null;
  }): Promise<ProjectPluginActionPayload> {
    const module = getPluginModule(options.pluginId);
    if (!module.runAction) {
      throw new UnsupportedPluginActionError(options.pluginId, options.actionId);
    }
    return module.runAction(options);
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
export {
  ContactFormPluginNotEnabledError,
  ContactFormRecipientRequiredError,
  ContactFormRecipientVerificationError,
  PluginActionArgumentError,
  UnsupportedPluginActionError,
};
