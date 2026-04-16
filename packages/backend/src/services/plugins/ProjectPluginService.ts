import {
  ContactFormPluginNotEnabledError,
  ContactFormRecipientRequiredError,
  ContactFormRecipientVerificationError,
} from "./contactForm/service";
import {
  projectPluginInstanceService,
  type ProjectPluginInstanceSummary,
} from "./core/instanceService";
import {
  buildPluginInfoContractPayload,
  PluginActionArgumentError,
  type ProjectPluginActionPayload,
  type ProjectPluginInfoContractPayload,
  type ProjectPluginReadPayload,
  UnsupportedPluginReadError,
  UnsupportedPluginActionError,
} from "./core/module";
import {
  externalEmbedPluginService,
  ExternalEmbedPluginNotEnabledError,
} from "./externalEmbed/service";
import { pluginEntitlementService } from "./PluginEntitlementService";
import {
  derivePluginInstallState,
  type ProjectPluginCatalogItem,
} from "./surfaceTypes";
import {
  listPluginCatalogEntries,
  getPluginManifest,
  type PluginCatalogEntry,
  type PluginId,
} from "./catalog";
import { getPluginModule } from "./registry";

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
    const manifest = getPluginManifest(options.pluginId);
    if (manifest.kind === "external_embed") {
      return externalEmbedPluginService.ensurePluginInstance({
        ...options,
        manifest,
      });
    }

    return getPluginModule(options.pluginId).ensureInstance(options);
  }

  async getPluginInfoContract(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<ProjectPluginInfoContractPayload> {
    const manifest = getPluginManifest(options.pluginId);
    if (manifest.kind === "external_embed") {
      return buildPluginInfoContractPayload(
        manifest.definition,
        await externalEmbedPluginService.getInfoPayload({
          ...options,
          manifest,
        }),
      );
    }

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
    const manifest = getPluginManifest(options.pluginId);
    if (manifest.kind === "external_embed") {
      return buildPluginInfoContractPayload(
        manifest.definition,
        await externalEmbedPluginService.updateConfig({
          ...options,
          manifest,
        }),
      );
    }

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

  async readPluginData(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
    readId: string;
    input?: Record<string, unknown>;
  }): Promise<ProjectPluginReadPayload> {
    const module = getPluginModule(options.pluginId);
    const availableReads = module.definition.capabilities.reads ?? [];
    if (!module.runRead || !availableReads.some((read) => read.readId === options.readId)) {
      throw new UnsupportedPluginReadError(options.pluginId, options.readId);
    }
    return module.runRead({
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      readId: options.readId,
      input: options.input ?? {},
    });
  }
}

export const projectPluginService = new ProjectPluginService();
export type {
  ProjectPluginReadPayload,
  ProjectPluginInstanceSummary,
};
export {
  ContactFormPluginNotEnabledError,
  ContactFormRecipientRequiredError,
  ContactFormRecipientVerificationError,
  ExternalEmbedPluginNotEnabledError,
  PluginActionArgumentError,
  UnsupportedPluginReadError,
  UnsupportedPluginActionError,
};
