import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  organization,
  projectMeta,
  projectPublishChecklist,
  projectTag,
  projectVersion,
} from "../../db/schema";
import type { PrePublishChecklist } from "../../types/checklistTypes";
import { installProfileService } from "../system/InstallProfileService";

export type ProjectMetaRow = typeof projectMeta.$inferSelect;
export type ProjectVersionRow = typeof projectVersion.$inferSelect;
export type ProjectTagRow = typeof projectTag.$inferSelect;

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

const DEFAULT_PROJECT_TAG_COLOR_IDS = [
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "teal",
  "sky",
  "blue",
  "indigo",
  "violet",
  "pink",
  "slate",
] as const;

function getDefaultProjectTagColorId(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return DEFAULT_PROJECT_TAG_COLOR_IDS[hash % DEFAULT_PROJECT_TAG_COLOR_IDS.length]!;
}

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
    const instancePolicy = await installProfileService.resolvePolicy();
    const instanceMaxProjects = parseMaxProjectsLimit(instancePolicy.limitDefaults);

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

        const orgMaxProjects = instancePolicy.capabilities.orgLimitOverrides
          ? parseMaxProjectsLimit(orgRows[0]?.limits)
          : null;
        const maxProjects = orgMaxProjects ?? instanceMaxProjects;
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
      if (maxVersion === null) {
        await tx
          .delete(projectMeta)
          .where(
            and(
              eq(projectMeta.organizationId, options.organizationId),
              eq(projectMeta.slug, options.slug),
            ),
          );
        return;
      }

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

  async setProjectTitle(options: {
    organizationId: string;
    slug: string;
    title: string;
  }): Promise<{ updatedVersions: number }> {
    return db.transaction(async (tx) => {
      const now = new Date();
      const projectRows = await tx
        .update(projectMeta)
        .set({ title: options.title, updatedAt: now })
        .where(
          and(
            eq(projectMeta.organizationId, options.organizationId),
            eq(projectMeta.slug, options.slug),
          ),
        )
        .returning({ slug: projectMeta.slug });

      if (projectRows.length === 0) {
        throw new Error("Project not found");
      }

      const versionRows = await tx
        .update(projectVersion)
        .set({ title: options.title, updatedAt: now })
        .where(
          and(
            eq(projectVersion.organizationId, options.organizationId),
            eq(projectVersion.projectSlug, options.slug),
          ),
        )
        .returning({ id: projectVersion.id });

      return { updatedVersions: versionRows.length };
    });
  }

  async setTags(options: {
    organizationId: string;
    slug: string;
    tags: string[];
  }): Promise<void> {
    const rows = await db
      .update(projectMeta)
      .set({ tags: options.tags, updatedAt: new Date() })
      .where(
        and(
          eq(projectMeta.organizationId, options.organizationId),
          eq(projectMeta.slug, options.slug),
        ),
      )
      .returning({ slug: projectMeta.slug });

    if (rows.length === 0) {
      throw new Error("Project not found");
    }

    await this.ensureProjectTags({
      organizationId: options.organizationId,
      tags: options.tags,
    });
  }

  async ensureProjectTags(options: {
    organizationId: string;
    tags: string[];
  }): Promise<void> {
    const tags = Array.from(new Set(options.tags));
    if (tags.length === 0) return;

    const now = new Date();
    await db
      .insert(projectTag)
      .values(
        tags.map((tag) => ({
          organizationId: options.organizationId,
          tag,
          colorId: getDefaultProjectTagColorId(tag),
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing();
  }

  async listOrganizationTags(options: {
    organizationId: string;
  }): Promise<Array<{ tag: string; colorId: string | null }>> {
    const projects = await db.query.projectMeta.findMany({
      where: eq(projectMeta.organizationId, options.organizationId),
      columns: {
        tags: true,
      },
    });

    const tags = Array.from(
      new Set(projects.flatMap((project) => project.tags)),
    ).sort((a, b) => a.localeCompare(b));

    if (tags.length === 0) return [];

    const stored = await db.query.projectTag.findMany({
      where: eq(projectTag.organizationId, options.organizationId),
      columns: {
        tag: true,
        colorId: true,
      },
    });

    const colorByTag = new Map(stored.map((row) => [row.tag, row.colorId ?? null]));

    return tags.map((tag) => ({
      tag,
      colorId: colorByTag.get(tag) ?? null,
    }));
  }

  async setTagColor(options: {
    organizationId: string;
    tag: string;
    colorId: string;
  }): Promise<void> {
    await db
      .insert(projectTag)
      .values({
        organizationId: options.organizationId,
        tag: options.tag,
        colorId: options.colorId,
      })
      .onConflictDoUpdate({
        target: [projectTag.organizationId, projectTag.tag],
        set: {
          colorId: options.colorId,
          updatedAt: new Date(),
        },
      });
  }

  async renameTagInOrganization(options: {
    organizationId: string;
    fromTag: string;
    toTag: string;
  }): Promise<{ updatedSlugs: string[] }> {
    if (options.fromTag === options.toTag) {
      return { updatedSlugs: [] };
    }

    const projects = await db.query.projectMeta.findMany({
      where: eq(projectMeta.organizationId, options.organizationId),
      columns: {
        slug: true,
        tags: true,
      },
    });

    const updates = projects.flatMap((project) => {
      const nextTags = Array.from(
        new Set(
          project.tags.map((tag) =>
            tag === options.fromTag ? options.toTag : tag,
          ),
        ),
      );
      const unchanged =
        nextTags.length === project.tags.length &&
        nextTags.every((tag, index) => tag === project.tags[index]);
      if (unchanged) return [];
      return [{ slug: project.slug, tags: nextTags }];
    });

    const sourceTag = await db.query.projectTag.findFirst({
      where: and(
        eq(projectTag.organizationId, options.organizationId),
        eq(projectTag.tag, options.fromTag),
      ),
      columns: {
        colorId: true,
      },
    });
    const targetTag = await db.query.projectTag.findFirst({
      where: and(
        eq(projectTag.organizationId, options.organizationId),
        eq(projectTag.tag, options.toTag),
      ),
      columns: {
        colorId: true,
      },
    });

    const now = new Date();
    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx
          .update(projectMeta)
          .set({ tags: update.tags, updatedAt: now })
          .where(
            and(
              eq(projectMeta.organizationId, options.organizationId),
              eq(projectMeta.slug, update.slug),
            ),
          );
      }

      const shouldCreateTarget = !targetTag && (sourceTag || updates.length > 0);
      if (shouldCreateTarget) {
        await tx
          .insert(projectTag)
          .values({
            organizationId: options.organizationId,
            tag: options.toTag,
            colorId:
              sourceTag?.colorId ??
              getDefaultProjectTagColorId(options.fromTag),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }

      if (targetTag && !targetTag.colorId && sourceTag?.colorId) {
        await tx
          .update(projectTag)
          .set({
            colorId: sourceTag.colorId,
            updatedAt: now,
          })
          .where(
            and(
              eq(projectTag.organizationId, options.organizationId),
              eq(projectTag.tag, options.toTag),
            ),
          );
      }

      await tx
        .delete(projectTag)
        .where(
          and(
            eq(projectTag.organizationId, options.organizationId),
            eq(projectTag.tag, options.fromTag),
          ),
        );
    });

    return { updatedSlugs: updates.map((update) => update.slug) };
  }

  async removeTagFromOrganization(options: {
    organizationId: string;
    tag: string;
  }): Promise<{ updatedSlugs: string[] }> {
    const projects = await db.query.projectMeta.findMany({
      where: eq(projectMeta.organizationId, options.organizationId),
      columns: {
        slug: true,
        tags: true,
      },
    });

    const updates = projects.flatMap((project) => {
      const nextTags = project.tags.filter((tag) => tag !== options.tag);
      if (nextTags.length === project.tags.length) return [];
      return [{ slug: project.slug, tags: nextTags }];
    });

    const now = new Date();
    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx
          .update(projectMeta)
          .set({ tags: update.tags, updatedAt: now })
          .where(
            and(
              eq(projectMeta.organizationId, options.organizationId),
              eq(projectMeta.slug, update.slug),
              ),
          );
      }

      await tx
        .delete(projectTag)
        .where(
          and(
            eq(projectTag.organizationId, options.organizationId),
            eq(projectTag.tag, options.tag),
          ),
        );
    });

    return { updatedSlugs: updates.map((update) => update.slug) };
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
