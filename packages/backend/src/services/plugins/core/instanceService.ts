import { getPluginManifest, type PluginId } from "../registry";
import {
  ensureProjectPluginInstance,
  getProjectPluginInstance,
  listProjectPluginInstances,
  toProjectPluginInstanceSummary,
  type ProjectPluginInstanceRow,
  type ProjectPluginInstanceSummary,
} from "./instanceStore";

class ProjectPluginInstanceService {
  async listProjectPluginInstances(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ProjectPluginInstanceRow[]> {
    return listProjectPluginInstances(options);
  }

  async getPluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<ProjectPluginInstanceRow | null> {
    return getProjectPluginInstance(options);
  }

  async ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<{ row: ProjectPluginInstanceRow; created: boolean }> {
    const manifest = getPluginManifest(options.pluginId);
    return ensureProjectPluginInstance({
      ...options,
      defaultConfig: manifest.definition.defaultConfig,
    });
  }

  toSummary(row: ProjectPluginInstanceRow): ProjectPluginInstanceSummary {
    return toProjectPluginInstanceSummary(row);
  }
}

export const projectPluginInstanceService = new ProjectPluginInstanceService();
export type { ProjectPluginInstanceRow, ProjectPluginInstanceSummary };
