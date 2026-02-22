import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../../db";
import { projectPluginInstance } from "../../../db/schema";
import { getPluginManifest, type PluginId } from "../registry";

export type ProjectPluginInstanceRow = typeof projectPluginInstance.$inferSelect;

export interface ProjectPluginInstanceSummary {
  instanceId: string;
  pluginId: string;
  status: string;
  publicToken: string;
  createdAt: string;
  updatedAt: string;
}

function generatePublicToken(): string {
  return `${randomUUID()}.${randomBytes(24).toString("base64url")}`;
}

function isPgUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const topLevelCode = (error as { code?: unknown }).code;
  if (topLevelCode === "23505") return true;

  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return false;
  return (cause as { code?: unknown }).code === "23505";
}

class ProjectPluginInstanceService {
  async listProjectPluginInstances(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<ProjectPluginInstanceRow[]> {
    return db.query.projectPluginInstance.findMany({
      where: and(
        eq(projectPluginInstance.organizationId, options.organizationId),
        eq(projectPluginInstance.projectSlug, options.projectSlug),
      ),
      orderBy: [asc(projectPluginInstance.pluginId)],
    });
  }

  async getPluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<ProjectPluginInstanceRow | null> {
    return (
      (await db.query.projectPluginInstance.findFirst({
        where: and(
          eq(projectPluginInstance.organizationId, options.organizationId),
          eq(projectPluginInstance.projectSlug, options.projectSlug),
          eq(projectPluginInstance.pluginId, options.pluginId),
        ),
      })) ?? null
    );
  }

  async ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<{ row: ProjectPluginInstanceRow; created: boolean }> {
    const existing = await this.getPluginInstance(options);
    if (existing) {
      if (existing.status === "enabled") {
        return { row: existing, created: false };
      }

      const [updated] = await db
        .update(projectPluginInstance)
        .set({ status: "enabled", updatedAt: new Date() })
        .where(eq(projectPluginInstance.id, existing.id))
        .returning();

      return {
        row: updated ?? existing,
        created: false,
      };
    }

    const manifest = getPluginManifest(options.pluginId);
    const now = new Date();

    try {
      const [created] = await db
        .insert(projectPluginInstance)
        .values({
          id: randomUUID(),
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginId: options.pluginId,
          status: "enabled",
          configJson: manifest.defaultConfig,
          publicToken: generatePublicToken(),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!created) {
        throw new Error("Failed to create plugin instance");
      }

      return { row: created, created: true };
    } catch (error) {
      if (!isPgUniqueViolation(error)) {
        throw error;
      }
      const afterConflict = await this.getPluginInstance(options);
      if (!afterConflict) throw error;
      return { row: afterConflict, created: false };
    }
  }

  toSummary(row: ProjectPluginInstanceRow): ProjectPluginInstanceSummary {
    return {
      instanceId: row.id,
      pluginId: row.pluginId,
      status: row.status,
      publicToken: row.publicToken,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const projectPluginInstanceService = new ProjectPluginInstanceService();
