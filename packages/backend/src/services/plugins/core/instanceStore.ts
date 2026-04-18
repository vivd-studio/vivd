import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../../db";
import { projectPluginInstance } from "../../../db/schema";

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

export async function listProjectPluginInstances(options: {
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

export async function getProjectPluginInstance(options: {
  organizationId: string;
  projectSlug: string;
  pluginId: string;
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

export async function ensureProjectPluginInstance(options: {
  organizationId: string;
  projectSlug: string;
  pluginId: string;
  defaultConfig: unknown;
}): Promise<{ row: ProjectPluginInstanceRow; created: boolean }> {
  const existing = await getProjectPluginInstance(options);
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
        configJson: options.defaultConfig,
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
    const afterConflict = await getProjectPluginInstance(options);
    if (!afterConflict) throw error;
    return { row: afterConflict, created: false };
  }
}

export async function updateProjectPluginInstance(options: {
  instanceId: string;
  configJson?: unknown;
  status?: string;
  updatedAt?: Date;
}): Promise<ProjectPluginInstanceRow | null> {
  const updates: {
    configJson?: unknown;
    status?: string;
    updatedAt: Date;
  } = {
    updatedAt: options.updatedAt ?? new Date(),
  };
  if (Object.prototype.hasOwnProperty.call(options, "configJson")) {
    updates.configJson = options.configJson;
  }
  if (typeof options.status === "string") {
    updates.status = options.status;
  }

  const [updated] = await db
    .update(projectPluginInstance)
    .set(updates)
    .where(eq(projectPluginInstance.id, options.instanceId))
    .returning();

  return updated ?? null;
}

export function toProjectPluginInstanceSummary(
  row: ProjectPluginInstanceRow,
): ProjectPluginInstanceSummary {
  return {
    instanceId: row.id,
    pluginId: row.pluginId,
    status: row.status,
    publicToken: row.publicToken,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
