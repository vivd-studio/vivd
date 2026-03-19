import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  analyticsEvent,
  contactFormSubmission,
  organization,
  pluginEntitlement,
  publishedSite,
  projectMeta,
  projectPluginInstance,
} from "../../db/schema";
import type { PluginId } from "./registry";
import { installProfileService } from "../system/InstallProfileService";

export type PluginEntitlementScope =
  | "instance"
  | "organization"
  | "project"
  | "none";
export type PluginEntitlementState = "disabled" | "enabled" | "suspended";
export type PluginEntitlementManagedBy =
  | "manual_superadmin"
  | "plan"
  | "self_serve";

export interface ResolvedPluginEntitlement {
  organizationId: string;
  projectSlug: string;
  pluginId: PluginId;
  scope: PluginEntitlementScope;
  state: PluginEntitlementState;
  managedBy: PluginEntitlementManagedBy;
  monthlyEventLimit: number | null;
  hardStop: boolean;
  turnstileEnabled: boolean;
  turnstileWidgetId: string | null;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
  notes: string;
  changedByUserId: string | null;
  updatedAt: Date | null;
}

type PluginEntitlementRow = typeof pluginEntitlement.$inferSelect;

export interface PluginAccessListOptions {
  pluginId: PluginId;
  organizationId?: string;
  search?: string;
  state?: PluginEntitlementState;
  limit?: number;
  offset?: number;
}

export interface PluginAccessListRow {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  projectSlug: string;
  projectTitle: string;
  isDeployed: boolean;
  deployedDomain: string | null;
  effectiveScope: PluginEntitlementScope;
  state: PluginEntitlementState;
  managedBy: PluginEntitlementManagedBy;
  monthlyEventLimit: number | null;
  hardStop: boolean;
  turnstileEnabled: boolean;
  turnstileReady: boolean;
  usageThisMonth: number;
  projectPluginStatus: "enabled" | "disabled" | null;
  updatedAt: Date | null;
}

function normalizeState(raw: string | null | undefined): PluginEntitlementState {
  if (raw === "enabled" || raw === "suspended") return raw;
  return "disabled";
}

function normalizeManagedBy(raw: string | null | undefined): PluginEntitlementManagedBy {
  if (raw === "plan" || raw === "self_serve") return raw;
  return "manual_superadmin";
}

function normalizeScope(raw: string | null | undefined): PluginEntitlementScope {
  if (raw === "instance" || raw === "organization" || raw === "project") return raw;
  return "none";
}

function toResolvedEntitlement(
  options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  },
  row: PluginEntitlementRow | null,
): ResolvedPluginEntitlement {
  if (!row) {
    return {
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      pluginId: options.pluginId,
      scope: "none",
      state: "disabled",
      managedBy: "manual_superadmin",
      monthlyEventLimit: null,
      hardStop: true,
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
      notes: "",
      changedByUserId: null,
      updatedAt: null,
    };
  }

  return {
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    pluginId: options.pluginId,
    scope: normalizeScope(row.scope),
    state: normalizeState(row.state),
    managedBy: normalizeManagedBy(row.managedBy),
    monthlyEventLimit:
      typeof row.monthlyEventLimit === "number" ? row.monthlyEventLimit : null,
    hardStop: row.hardStop ?? true,
    turnstileEnabled: row.turnstileEnabled ?? false,
    turnstileWidgetId: row.turnstileWidgetId ?? null,
    turnstileSiteKey: row.turnstileSiteKey ?? null,
    turnstileSecretKey: row.turnstileSecretKey ?? null,
    notes: row.notes || "",
    changedByUserId: row.changedByUserId ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

function buildEntitlementMaps(rows: PluginEntitlementRow[]) {
  const byProject = new Map<string, PluginEntitlementRow>();
  const byOrganization = new Map<string, PluginEntitlementRow>();

  for (const row of rows) {
    if (row.scope === "project" && row.projectSlug) {
      byProject.set(`${row.organizationId}:${row.projectSlug}`, row);
      continue;
    }
    if (row.scope === "organization") {
      byOrganization.set(row.organizationId, row);
    }
  }

  return { byProject, byOrganization };
}

function toInstanceResolvedEntitlement(
  options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  },
  state: PluginEntitlementState,
): ResolvedPluginEntitlement {
  return {
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    pluginId: options.pluginId,
    scope: "instance",
    state,
    managedBy: "manual_superadmin",
    monthlyEventLimit: null,
    hardStop: true,
    turnstileEnabled: false,
    turnstileWidgetId: null,
    turnstileSiteKey: null,
    turnstileSecretKey: null,
    notes: "",
    changedByUserId: null,
    updatedAt: null,
  };
}

class PluginEntitlementService {
  async getProjectEntitlementRow(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<PluginEntitlementRow | null> {
    const row = await db.query.pluginEntitlement.findFirst({
      where: and(
        eq(pluginEntitlement.organizationId, options.organizationId),
        eq(pluginEntitlement.scope, "project"),
        eq(pluginEntitlement.projectSlug, options.projectSlug),
        eq(pluginEntitlement.pluginId, options.pluginId),
      ),
    });
    return row ?? null;
  }

  async resolveEffectiveEntitlement(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<ResolvedPluginEntitlement> {
    const instancePolicy = await installProfileService.resolvePolicy();
    const rows = await db.query.pluginEntitlement.findMany({
      where: and(
        eq(pluginEntitlement.organizationId, options.organizationId),
        eq(pluginEntitlement.pluginId, options.pluginId),
      ),
    });

    const { byProject, byOrganization } = buildEntitlementMaps(rows);
    const row =
      (instancePolicy.capabilities.projectPluginEntitlements
        ? byProject.get(`${options.organizationId}:${options.projectSlug}`)
        : null) ??
      (instancePolicy.capabilities.orgPluginEntitlements
        ? byOrganization.get(options.organizationId)
        : null) ??
      null;

    if (row) {
      return toResolvedEntitlement(options, row);
    }

    return toInstanceResolvedEntitlement(
      options,
      instancePolicy.pluginDefaults[options.pluginId].state,
    );
  }

  async listProjectAccess(
    options: PluginAccessListOptions,
  ): Promise<{ rows: PluginAccessListRow[]; total: number }> {
    const instancePolicy = await installProfileService.resolvePolicy();
    const limit = Math.max(1, Math.min(500, options.limit ?? 100));
    const offset = Math.max(0, options.offset ?? 0);
    const search = options.search?.trim().toLowerCase() || "";

    const projectRows = await db
      .select({
        organizationId: organization.id,
        organizationSlug: organization.slug,
        organizationName: organization.name,
        projectSlug: projectMeta.slug,
        projectTitle: projectMeta.title,
        pluginStatus: projectPluginInstance.status,
      })
      .from(projectMeta)
      .innerJoin(organization, eq(projectMeta.organizationId, organization.id))
      .leftJoin(
        projectPluginInstance,
        and(
          eq(projectPluginInstance.organizationId, projectMeta.organizationId),
          eq(projectPluginInstance.projectSlug, projectMeta.slug),
          eq(projectPluginInstance.pluginId, options.pluginId),
        ),
      )
      .where(
        options.organizationId
          ? eq(projectMeta.organizationId, options.organizationId)
          : undefined,
      );

    const entitlementRows = await db.query.pluginEntitlement.findMany({
      where: and(
        eq(pluginEntitlement.pluginId, options.pluginId),
        options.organizationId
          ? eq(pluginEntitlement.organizationId, options.organizationId)
          : undefined,
      ),
    });
    const { byProject, byOrganization } = buildEntitlementMaps(entitlementRows);

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const usageRows =
      options.pluginId === "contact_form"
        ? await db
            .select({
              organizationId: contactFormSubmission.organizationId,
              projectSlug: contactFormSubmission.projectSlug,
              count: sql<number>`count(*)`,
            })
            .from(contactFormSubmission)
            .where(
              and(
                gte(contactFormSubmission.createdAt, monthStart),
                options.organizationId
                  ? eq(contactFormSubmission.organizationId, options.organizationId)
                  : undefined,
              ),
            )
            .groupBy(
              contactFormSubmission.organizationId,
              contactFormSubmission.projectSlug,
            )
        : options.pluginId === "analytics"
          ? await db
              .select({
                organizationId: analyticsEvent.organizationId,
                projectSlug: analyticsEvent.projectSlug,
                count: sql<number>`count(*)`,
              })
              .from(analyticsEvent)
              .where(
                and(
                  gte(analyticsEvent.createdAt, monthStart),
                  options.organizationId
                    ? eq(analyticsEvent.organizationId, options.organizationId)
                    : undefined,
                ),
              )
              .groupBy(analyticsEvent.organizationId, analyticsEvent.projectSlug)
          : [];
    const usageByProject = new Map<string, number>(
      usageRows.map((row) => [
        `${row.organizationId}:${row.projectSlug}`,
        Number(row.count) || 0,
      ]),
    );
    const publishedRows = await db
      .select({
        organizationId: publishedSite.organizationId,
        projectSlug: publishedSite.projectSlug,
        domain: publishedSite.domain,
        publishedAt: publishedSite.publishedAt,
      })
      .from(publishedSite)
      .where(
        options.organizationId
          ? eq(publishedSite.organizationId, options.organizationId)
          : undefined,
      );
    const deployedByProject = new Map<
      string,
      { domain: string; publishedAt: Date }
    >();
    for (const row of publishedRows) {
      const key = `${row.organizationId}:${row.projectSlug}`;
      const existing = deployedByProject.get(key);
      if (!existing || row.publishedAt > existing.publishedAt) {
        deployedByProject.set(key, {
          domain: row.domain,
          publishedAt: row.publishedAt,
        });
      }
    }

    const collected: PluginAccessListRow[] = [];

    for (const row of projectRows) {
      const entitlement =
        (instancePolicy.capabilities.projectPluginEntitlements
          ? byProject.get(`${row.organizationId}:${row.projectSlug}`)
          : null) ??
        (instancePolicy.capabilities.orgPluginEntitlements
          ? byOrganization.get(row.organizationId)
          : null) ??
        null;
      const entitlementOptions = {
        organizationId: row.organizationId,
        projectSlug: row.projectSlug,
        pluginId: options.pluginId,
      };
      const resolved = entitlement
        ? toResolvedEntitlement(entitlementOptions, entitlement)
        : toInstanceResolvedEntitlement(
            entitlementOptions,
            instancePolicy.pluginDefaults[options.pluginId].state,
          );

      if (options.state && resolved.state !== options.state) continue;

      if (search) {
        const deployment = deployedByProject.get(
          `${row.organizationId}:${row.projectSlug}`,
        );
        const haystack = [
          row.organizationSlug,
          row.organizationName,
          row.projectSlug,
          row.projectTitle || "",
          deployment?.domain ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) continue;
      }

      const deployment = deployedByProject.get(
        `${row.organizationId}:${row.projectSlug}`,
      );

      collected.push({
        organizationId: row.organizationId,
        organizationSlug: row.organizationSlug,
        organizationName: row.organizationName,
        projectSlug: row.projectSlug,
        projectTitle: row.projectTitle || "",
        isDeployed: !!deployment,
        deployedDomain: deployment?.domain ?? null,
        effectiveScope: resolved.scope,
        state: resolved.state,
        managedBy: resolved.managedBy,
        monthlyEventLimit: resolved.monthlyEventLimit,
        hardStop: resolved.hardStop,
        turnstileEnabled: resolved.turnstileEnabled,
        turnstileReady: !!resolved.turnstileSiteKey && !!resolved.turnstileSecretKey,
        usageThisMonth:
          usageByProject.get(`${row.organizationId}:${row.projectSlug}`) ?? 0,
        projectPluginStatus:
          row.pluginStatus === "enabled" || row.pluginStatus === "disabled"
            ? row.pluginStatus
            : null,
        updatedAt: resolved.updatedAt,
      });
    }

    collected.sort((a, b) => {
      const org = a.organizationSlug.localeCompare(b.organizationSlug);
      if (org !== 0) return org;
      return a.projectSlug.localeCompare(b.projectSlug);
    });

    return {
      rows: collected.slice(offset, offset + limit),
      total: collected.length,
    };
  }

  async upsertEntitlement(input: {
    organizationId: string;
    scope: "organization" | "project";
    projectSlug?: string | null;
    pluginId: PluginId;
    state: PluginEntitlementState;
    managedBy?: PluginEntitlementManagedBy;
    monthlyEventLimit?: number | null;
    hardStop?: boolean;
    turnstileEnabled?: boolean;
    turnstileWidgetId?: string | null;
    turnstileSiteKey?: string | null;
    turnstileSecretKey?: string | null;
    notes?: string;
    changedByUserId?: string | null;
  }): Promise<PluginEntitlementRow> {
    const instancePolicy = await installProfileService.resolvePolicy();
    if (input.scope === "organization" && !instancePolicy.capabilities.orgPluginEntitlements) {
      throw new Error("Organization-level plugin entitlements are disabled for this install");
    }
    if (input.scope === "project" && !instancePolicy.capabilities.projectPluginEntitlements) {
      throw new Error("Project-level plugin entitlements are disabled for this install");
    }

    const projectSlug =
      input.scope === "organization" ? "" : (input.projectSlug || "").trim();
    if (input.scope === "project" && !projectSlug) {
      throw new Error("projectSlug is required for project-scope entitlements");
    }

    const monthlyEventLimit =
      typeof input.monthlyEventLimit === "number" && Number.isFinite(input.monthlyEventLimit)
        ? Math.max(0, Math.floor(input.monthlyEventLimit))
        : null;
    const turnstileEnabled = input.turnstileEnabled ?? false;
    const turnstileWidgetId = (input.turnstileWidgetId || "").trim() || null;
    const turnstileSiteKey = (input.turnstileSiteKey || "").trim() || null;
    const turnstileSecretKey = (input.turnstileSecretKey || "").trim() || null;

    const now = new Date();
    const [row] = await db
      .insert(pluginEntitlement)
      .values({
        id: randomUUID(),
        organizationId: input.organizationId,
        scope: input.scope,
        projectSlug,
        pluginId: input.pluginId,
        state: input.state,
        managedBy: input.managedBy || "manual_superadmin",
        monthlyEventLimit,
        hardStop: input.hardStop ?? true,
        turnstileEnabled,
        turnstileWidgetId,
        turnstileSiteKey,
        turnstileSecretKey,
        notes: (input.notes || "").trim(),
        changedByUserId: input.changedByUserId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          pluginEntitlement.organizationId,
          pluginEntitlement.scope,
          pluginEntitlement.projectSlug,
          pluginEntitlement.pluginId,
        ],
        set: {
          state: input.state,
          managedBy: input.managedBy || "manual_superadmin",
          monthlyEventLimit,
          hardStop: input.hardStop ?? true,
          turnstileEnabled,
          turnstileWidgetId,
          turnstileSiteKey,
          turnstileSecretKey,
          notes: (input.notes || "").trim(),
          changedByUserId: input.changedByUserId ?? null,
          updatedAt: now,
        },
      })
      .returning();

    if (!row) {
      throw new Error("Failed to upsert plugin entitlement");
    }

    return row;
  }

}

export const pluginEntitlementService = new PluginEntitlementService();
