import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  organization,
  projectMeta,
  projectPublishChecklist,
  projectVersion,
} from "../../db/schema";
import type { PrePublishChecklist } from "../../types/checklistTypes";

export type ProjectMetaRow = typeof projectMeta.$inferSelect;
export type ProjectVersionRow = typeof projectVersion.$inferSelect;

export type CreateProjectVersionInput = {
  organizationId: string;
  slug: string;
  version: number;
  source: "url" | "scratch";
  url: string;
  title: string;
  description: string;
  status: string;
  createdAt: Date;
};

function parseMaxProjectsLimit(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>).maxProjects;
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

class ProjectMetaService {
  async listProjects(organizationId: string): Promise<ProjectMetaRow[]> {
    return db.query.projectMeta.findMany({
      where: eq(projectMeta.organizationId, organizationId),
      orderBy: desc(projectMeta.updatedAt),
    });
  }

  async getProject(organizationId: string, slug: string): Promise<ProjectMetaRow | null> {
    const record = await db.query.projectMeta.findFirst({
      where: and(
        eq(projectMeta.organizationId, organizationId),
        eq(projectMeta.slug, slug),
      ),
    });
    return record ?? null;
  }

  async getProjectVersion(
    organizationId: string,
    slug: string,
    version: number,
  ): Promise<ProjectVersionRow | null> {
    const record = await db.query.projectVersion.findFirst({
      where: and(
        eq(projectVersion.organizationId, organizationId),
        eq(projectVersion.projectSlug, slug),
        eq(projectVersion.version, version),
      ),
    });
    return record ?? null;
  }

  async listProjectVersions(organizationId: string, slug: string): Promise<ProjectVersionRow[]> {
    return db.query.projectVersion.findMany({
      where: and(
        eq(projectVersion.organizationId, organizationId),
        eq(projectVersion.projectSlug, slug),
      ),
      orderBy: projectVersion.version,
    });
  }

  async getCurrentVersion(organizationId: string, slug: string): Promise<number> {
    const project = await this.getProject(organizationId, slug);
    return project?.currentVersion ?? 0;
  }

  async getNextVersion(organizationId: string, slug: string): Promise<number> {
    const rows = await db
      .select({
        maxVersion: sql<number | null>`max(${projectVersion.version})`,
      })
      .from(projectVersion)
      .where(
        and(
          eq(projectVersion.organizationId, organizationId),
          eq(projectVersion.projectSlug, slug),
        ),
      );

    const maxVersion = rows[0]?.maxVersion ?? null;
    return (maxVersion ?? 0) + 1;
  }

  async createProjectVersion(input: CreateProjectVersionInput): Promise<void> {
    await db.transaction(async (tx) => {
      const existingProject = await tx.query.projectMeta.findFirst({
        where: and(
          eq(projectMeta.organizationId, input.organizationId),
          eq(projectMeta.slug, input.slug),
        ),
        columns: { slug: true },
      });

      // Organization limit: maxProjects (0/undefined = unlimited)
      if (!existingProject) {
        // Lock org row so concurrent project creations can't exceed the limit.
        const orgRows = await tx
          .select({ limits: organization.limits })
          .from(organization)
          .where(eq(organization.id, input.organizationId))
          .for("update");

        const maxProjects = parseMaxProjectsLimit(orgRows[0]?.limits);
        if (maxProjects !== null) {
          const rows = await tx
            .select({
              count: sql<number>`count(*)`,
            })
            .from(projectMeta)
            .where(eq(projectMeta.organizationId, input.organizationId));

          const currentCount = Number(rows[0]?.count ?? 0);
          if (currentCount >= maxProjects) {
            throw new Error(
              `Project limit reached for this organization (${currentCount}/${maxProjects}).`,
            );
          }
        }
      }

      // Ensure project exists
      await tx
        .insert(projectMeta)
        .values({
          organizationId: input.organizationId,
          slug: input.slug,
          source: input.source,
          url: input.url,
          title: input.title,
          description: input.description,
          currentVersion: input.version,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .onConflictDoUpdate({
          target: [projectMeta.organizationId, projectMeta.slug],
          set: {
            source: input.source,
            url: input.url,
            title: input.title,
            description: input.description,
            // Only advance currentVersion; never downgrade.
            currentVersion: sql<number>`greatest(${projectMeta.currentVersion}, ${input.version})`,
            updatedAt: input.createdAt,
          },
        });

      // Insert (or update) version metadata
      await tx
        .insert(projectVersion)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          projectSlug: input.slug,
          version: input.version,
          source: input.source,
          url: input.url,
          title: input.title,
          description: input.description,
          status: input.status,
          startedAt: input.createdAt,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .onConflictDoUpdate({
          target: [
            projectVersion.organizationId,
            projectVersion.projectSlug,
            projectVersion.version,
          ],
          set: {
            source: input.source,
            url: input.url,
            title: input.title,
            description: input.description,
            status: input.status,
            startedAt: input.createdAt,
            errorMessage: null,
            updatedAt: input.createdAt,
          },
        });
    });
  }

  async deleteProjectVersion(options: {
    organizationId: string;
    slug: string;
    version: number;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(projectPublishChecklist)
        .where(
          and(
            eq(projectPublishChecklist.organizationId, options.organizationId),
            eq(projectPublishChecklist.projectSlug, options.slug),
            eq(projectPublishChecklist.version, options.version),
          ),
        );

      await tx
        .delete(projectVersion)
        .where(
          and(
            eq(projectVersion.organizationId, options.organizationId),
            eq(projectVersion.projectSlug, options.slug),
            eq(projectVersion.version, options.version),
          ),
        );

      const remaining = await tx
        .select({
          maxVersion: sql<number | null>`max(${projectVersion.version})`,
        })
        .from(projectVersion)
        .where(
          and(
            eq(projectVersion.organizationId, options.organizationId),
            eq(projectVersion.projectSlug, options.slug),
          ),
        );

      const maxVersion = remaining[0]?.maxVersion ?? null;

      const project = await tx.query.projectMeta.findFirst({
        where: and(
          eq(projectMeta.organizationId, options.organizationId),
          eq(projectMeta.slug, options.slug),
        ),
      });

      const max = maxVersion ?? 0;
      const current = project?.currentVersion ?? 0;
      const shouldAdjustCurrent = current === options.version || current > max;
      const nextCurrent = shouldAdjustCurrent ? max : current;

      await tx
        .update(projectMeta)
        .set({ currentVersion: nextCurrent, updatedAt: new Date() })
        .where(
          and(
            eq(projectMeta.organizationId, options.organizationId),
            eq(projectMeta.slug, options.slug),
          ),
        );
    });
  }

  async setCurrentVersion(
    organizationId: string,
    slug: string,
    version: number,
  ): Promise<void> {
    await db
      .update(projectMeta)
      .set({ currentVersion: version })
      .where(and(eq(projectMeta.organizationId, organizationId), eq(projectMeta.slug, slug)));
  }

  async touchUpdatedAt(organizationId: string, slug: string): Promise<void> {
    await db
      .update(projectMeta)
      .set({ updatedAt: new Date() })
      .where(and(eq(projectMeta.organizationId, organizationId), eq(projectMeta.slug, slug)));
  }

  async setPublicPreviewEnabled(options: {
    organizationId: string;
    slug: string;
    enabled: boolean;
  }): Promise<void> {
    await db
      .update(projectMeta)
      .set({ publicPreviewEnabled: options.enabled, updatedAt: new Date() })
      .where(
        and(
          eq(projectMeta.organizationId, options.organizationId),
          eq(projectMeta.slug, options.slug),
        ),
      );
  }

  async updateVersionStatus(options: {
    organizationId: string;
    slug: string;
    version: number;
    status: string;
    errorMessage?: string;
  }): Promise<void> {
    await db
      .update(projectVersion)
      .set({
        status: options.status,
        errorMessage: options.errorMessage ?? null,
      })
      .where(
        and(
          eq(projectVersion.organizationId, options.organizationId),
          eq(projectVersion.projectSlug, options.slug),
          eq(projectVersion.version, options.version),
        ),
      );

    await this.touchUpdatedAt(options.organizationId, options.slug);
  }

  async setVersionThumbnailKey(options: {
    organizationId: string;
    slug: string;
    version: number;
    thumbnailKey: string;
  }): Promise<void> {
    await db
      .update(projectVersion)
      .set({ thumbnailKey: options.thumbnailKey })
      .where(
        and(
          eq(projectVersion.organizationId, options.organizationId),
          eq(projectVersion.projectSlug, options.slug),
          eq(projectVersion.version, options.version),
        ),
      );

    await this.touchUpdatedAt(options.organizationId, options.slug);
  }

  async upsertPublishChecklist(options: {
    organizationId: string;
    checklist: PrePublishChecklist;
  }): Promise<void> {
    await db
      .insert(projectPublishChecklist)
      .values({
        id: randomUUID(),
        organizationId: options.organizationId,
        projectSlug: options.checklist.projectSlug,
        version: options.checklist.version,
        runAt: new Date(options.checklist.runAt),
        snapshotCommitHash: options.checklist.snapshotCommitHash ?? null,
        checklist: options.checklist,
      })
      .onConflictDoUpdate({
        target: [
          projectPublishChecklist.organizationId,
          projectPublishChecklist.projectSlug,
          projectPublishChecklist.version,
        ],
        set: {
          runAt: new Date(options.checklist.runAt),
          snapshotCommitHash: options.checklist.snapshotCommitHash ?? null,
          checklist: options.checklist,
          updatedAt: new Date(),
        },
      });

    await this.touchUpdatedAt(options.organizationId, options.checklist.projectSlug);
  }

  async getPublishChecklist(options: {
    organizationId: string;
    slug: string;
    version: number;
  }): Promise<PrePublishChecklist | null> {
    const record = await db.query.projectPublishChecklist.findFirst({
      where: and(
        eq(projectPublishChecklist.organizationId, options.organizationId),
        eq(projectPublishChecklist.projectSlug, options.slug),
        eq(projectPublishChecklist.version, options.version),
      ),
    });

    return (record?.checklist as PrePublishChecklist | undefined) ?? null;
  }
}

export const projectMetaService = new ProjectMetaService();
