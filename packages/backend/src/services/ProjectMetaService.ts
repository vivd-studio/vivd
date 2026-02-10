import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  projectMeta,
  projectPublishChecklist,
  projectVersion,
} from "../db/schema";
import type { PrePublishChecklist } from "../opencode/checklistTypes";

export type ProjectMetaRow = typeof projectMeta.$inferSelect;
export type ProjectVersionRow = typeof projectVersion.$inferSelect;

export type CreateProjectVersionInput = {
  slug: string;
  version: number;
  source: "url" | "scratch";
  url: string;
  title: string;
  description: string;
  status: string;
  createdAt: Date;
};

class ProjectMetaService {
  async listProjects(): Promise<ProjectMetaRow[]> {
    return db.query.projectMeta.findMany({
      orderBy: desc(projectMeta.updatedAt),
    });
  }

  async getProject(slug: string): Promise<ProjectMetaRow | null> {
    const record = await db.query.projectMeta.findFirst({
      where: eq(projectMeta.slug, slug),
    });
    return record ?? null;
  }

  async getProjectVersion(
    slug: string,
    version: number,
  ): Promise<ProjectVersionRow | null> {
    const record = await db.query.projectVersion.findFirst({
      where: and(
        eq(projectVersion.projectSlug, slug),
        eq(projectVersion.version, version),
      ),
    });
    return record ?? null;
  }

  async listProjectVersions(slug: string): Promise<ProjectVersionRow[]> {
    return db.query.projectVersion.findMany({
      where: eq(projectVersion.projectSlug, slug),
      orderBy: projectVersion.version,
    });
  }

  async getCurrentVersion(slug: string): Promise<number> {
    const project = await this.getProject(slug);
    return project?.currentVersion ?? 0;
  }

  async getNextVersion(slug: string): Promise<number> {
    const rows = await db
      .select({
        maxVersion: sql<number | null>`max(${projectVersion.version})`,
      })
      .from(projectVersion)
      .where(eq(projectVersion.projectSlug, slug));

    const maxVersion = rows[0]?.maxVersion ?? null;
    return (maxVersion ?? 0) + 1;
  }

  async createProjectVersion(input: CreateProjectVersionInput): Promise<void> {
    await db.transaction(async (tx) => {
      // Ensure project exists
      await tx
        .insert(projectMeta)
        .values({
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
          target: projectMeta.slug,
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
          target: [projectVersion.projectSlug, projectVersion.version],
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
    slug: string;
    version: number;
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(projectPublishChecklist)
        .where(
          and(
            eq(projectPublishChecklist.projectSlug, options.slug),
            eq(projectPublishChecklist.version, options.version),
          ),
        );

      await tx
        .delete(projectVersion)
        .where(
          and(
            eq(projectVersion.projectSlug, options.slug),
            eq(projectVersion.version, options.version),
          ),
        );

      const remaining = await tx
        .select({
          maxVersion: sql<number | null>`max(${projectVersion.version})`,
        })
        .from(projectVersion)
        .where(eq(projectVersion.projectSlug, options.slug));

      const maxVersion = remaining[0]?.maxVersion ?? null;

      const project = await tx.query.projectMeta.findFirst({
        where: eq(projectMeta.slug, options.slug),
      });

      const max = maxVersion ?? 0;
      const current = project?.currentVersion ?? 0;
      const shouldAdjustCurrent = current === options.version || current > max;
      const nextCurrent = shouldAdjustCurrent ? max : current;

      await tx
        .update(projectMeta)
        .set({ currentVersion: nextCurrent, updatedAt: new Date() })
        .where(eq(projectMeta.slug, options.slug));
    });
  }

  async setCurrentVersion(slug: string, version: number): Promise<void> {
    await db
      .update(projectMeta)
      .set({ currentVersion: version })
      .where(eq(projectMeta.slug, slug));
  }

  async touchUpdatedAt(slug: string): Promise<void> {
    await db
      .update(projectMeta)
      .set({ updatedAt: new Date() })
      .where(eq(projectMeta.slug, slug));
  }

  async setPublicPreviewEnabled(options: {
    slug: string;
    enabled: boolean;
  }): Promise<void> {
    await db
      .update(projectMeta)
      .set({ publicPreviewEnabled: options.enabled, updatedAt: new Date() })
      .where(eq(projectMeta.slug, options.slug));
  }

  async updateVersionStatus(options: {
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
          eq(projectVersion.projectSlug, options.slug),
          eq(projectVersion.version, options.version),
        ),
      );

    await this.touchUpdatedAt(options.slug);
  }

  async setVersionThumbnailKey(options: {
    slug: string;
    version: number;
    thumbnailKey: string;
  }): Promise<void> {
    await db
      .update(projectVersion)
      .set({ thumbnailKey: options.thumbnailKey })
      .where(
        and(
          eq(projectVersion.projectSlug, options.slug),
          eq(projectVersion.version, options.version),
        ),
      );

    await this.touchUpdatedAt(options.slug);
  }

  async upsertPublishChecklist(checklist: PrePublishChecklist): Promise<void> {
    await db
      .insert(projectPublishChecklist)
      .values({
        id: randomUUID(),
        projectSlug: checklist.projectSlug,
        version: checklist.version,
        runAt: new Date(checklist.runAt),
        snapshotCommitHash: checklist.snapshotCommitHash ?? null,
        checklist,
      })
      .onConflictDoUpdate({
        target: [
          projectPublishChecklist.projectSlug,
          projectPublishChecklist.version,
        ],
        set: {
          runAt: new Date(checklist.runAt),
          snapshotCommitHash: checklist.snapshotCommitHash ?? null,
          checklist,
          updatedAt: new Date(),
        },
      });

    await this.touchUpdatedAt(checklist.projectSlug);
  }

  async getPublishChecklist(options: {
    slug: string;
    version: number;
  }): Promise<PrePublishChecklist | null> {
    const record = await db.query.projectPublishChecklist.findFirst({
      where: and(
        eq(projectPublishChecklist.projectSlug, options.slug),
        eq(projectPublishChecklist.version, options.version),
      ),
    });

    return (record?.checklist as PrePublishChecklist | undefined) ?? null;
  }
}

export const projectMetaService = new ProjectMetaService();
