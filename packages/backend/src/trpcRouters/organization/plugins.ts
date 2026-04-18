import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  projectMeta,
  projectPluginInstance,
  publishedSite,
} from "../../db/schema";
import {
  PLUGIN_IDS,
  listPluginCatalogEntries,
  type PluginId,
} from "../../services/plugins/catalog";
import { buildOrganizationPluginProjectSummaries } from "../../services/plugins/integrationHooks";
import type {
  OrganizationProjectPluginItem,
  OrganizationPluginIssue,
  PluginSurfaceBadge,
} from "../../services/plugins/surfaceTypes";
import { orgAdminProcedure } from "../../trpc";

type PluginInstanceStatus = "enabled" | "disabled" | "not_installed";

function toPluginInstanceStatus(raw: string | null | undefined): PluginInstanceStatus {
  if (!raw) return "not_installed";
  if (raw === "enabled") return "enabled";
  return "disabled";
}

export const organizationPluginOverviewProcedures = {
  pluginsOverview: orgAdminProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;
    const pluginCatalog = listPluginCatalogEntries();
    const projects = await db.query.projectMeta.findMany({
      where: eq(projectMeta.organizationId, organizationId),
      columns: {
        slug: true,
        title: true,
        updatedAt: true,
      },
      orderBy: (table, { desc, asc: ascending }) => [
        desc(table.updatedAt),
        ascending(table.slug),
      ],
    });

    if (projects.length === 0) {
      return { rows: [] };
    }

    const projectSlugs = projects.map((project) => project.slug);

    const [pluginInstances, publishedRows] = await Promise.all([
      db.query.projectPluginInstance.findMany({
        where: and(
          eq(projectPluginInstance.organizationId, organizationId),
          inArray(projectPluginInstance.projectSlug, projectSlugs),
          inArray(projectPluginInstance.pluginId, PLUGIN_IDS),
        ),
        columns: {
          id: true,
          projectSlug: true,
          pluginId: true,
          status: true,
          configJson: true,
          updatedAt: true,
        },
      }),
      db.query.publishedSite.findMany({
        where: and(
          eq(publishedSite.organizationId, organizationId),
          inArray(publishedSite.projectSlug, projectSlugs),
        ),
        columns: {
          projectSlug: true,
          domain: true,
          publishedAt: true,
        },
      }),
    ]);

    const instanceByProjectPluginId = new Map<
      string,
      {
        id: string;
        status: string;
        configJson: unknown;
        updatedAt: Date;
      }
    >();
    for (const pluginInstance of pluginInstances) {
      instanceByProjectPluginId.set(
        `${pluginInstance.projectSlug}:${pluginInstance.pluginId}`,
        {
          id: pluginInstance.id,
          status: pluginInstance.status,
          configJson: pluginInstance.configJson,
          updatedAt: pluginInstance.updatedAt,
        },
      );
    }

    const pluginSummariesByPluginId = new Map<
      PluginId,
      Map<
        string,
        {
          summaryLines: string[];
          badges: PluginSurfaceBadge[];
          issues: OrganizationPluginIssue[];
        }
      >
    >();

    await Promise.all(
      pluginCatalog.map(async (catalog) => {
        const instancesByProjectSlug = new Map<
          string,
          { status: string | null; configJson: unknown } | null
        >(
          projects.map((project) => {
            const instance = instanceByProjectPluginId.get(
              `${project.slug}:${catalog.pluginId}`,
            );
            return [
              project.slug,
              instance
                ? {
                    status: instance.status ?? null,
                    configJson: instance.configJson ?? null,
                  }
                : null,
            ] as const;
          }),
        );

        const summaries = await buildOrganizationPluginProjectSummaries({
          pluginId: catalog.pluginId,
          organizationId,
          projectSlugs,
          instancesByProjectSlug,
        });

        pluginSummariesByPluginId.set(catalog.pluginId, summaries);
      }),
    );

    const deployedByProjectSlug = new Map<
      string,
      { domain: string; publishedAt: Date }
    >();
    for (const row of publishedRows) {
      const existing = deployedByProjectSlug.get(row.projectSlug);
      if (!existing || row.publishedAt > existing.publishedAt) {
        deployedByProjectSlug.set(row.projectSlug, {
          domain: row.domain,
          publishedAt: row.publishedAt,
        });
      }
    }

    const rows = projects.map((project) => {
      const projectSlug = project.slug;
      const plugins = pluginCatalog.map((catalog): OrganizationProjectPluginItem => {
        const instance = instanceByProjectPluginId.get(
          `${projectSlug}:${catalog.pluginId}`,
        );
        const status = toPluginInstanceStatus(instance?.status ?? null);
        const pluginSummary =
          pluginSummariesByPluginId.get(catalog.pluginId)?.get(projectSlug) ?? {
            summaryLines: [],
            badges: [],
            issues: [] as OrganizationPluginIssue[],
          };

        return {
          pluginId: catalog.pluginId,
          catalog,
          installState: status === "enabled" ? "enabled" : "disabled",
          entitled: status === "enabled",
          entitlementState: status === "enabled" ? "enabled" : "disabled",
          instanceId: instance?.id ?? null,
          instanceStatus: instance?.status ?? null,
          updatedAt: instance?.updatedAt?.toISOString() ?? null,
          accessRequest: {
            status: "not_requested",
            requestedAt: null,
            requestedByUserId: null,
            requesterEmail: null,
          },
          summaryLines: pluginSummary.summaryLines,
          badges: pluginSummary.badges,
        };
      });

      const issues = pluginCatalog.flatMap(
        (catalog) =>
          pluginSummariesByPluginId.get(catalog.pluginId)?.get(projectSlug)?.issues ??
          [],
      );

      return {
        projectSlug,
        projectTitle: project.title,
        updatedAt: project.updatedAt.toISOString(),
        deployedDomain: deployedByProjectSlug.get(projectSlug)?.domain ?? null,
        plugins,
        issues,
      };
    });

    return {
      rows: rows.sort((left, right) => {
        if (right.issues.length !== left.issues.length) {
          return right.issues.length - left.issues.length;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      }),
    };
  }),
};
