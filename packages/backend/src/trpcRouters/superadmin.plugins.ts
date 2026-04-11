import { z } from "zod";
import { superAdminProcedure } from "../trpc";
import { pluginEntitlementService } from "../services/plugins/PluginEntitlementService";
import { projectPluginService } from "../services/plugins/ProjectPluginService";
import {
  cleanupPluginProjectEntitlementFields,
  preparePluginProjectEntitlementFields,
} from "../services/plugins/integrationHooks";
import {
  PLUGIN_IDS,
  type PluginId,
  listPluginCatalogEntries,
} from "../services/plugins/registry";
import { organizationIdSchema } from "../lib/organizationIdentifiers";

const pluginIdSchema = z.enum(PLUGIN_IDS);
const pluginEntitlementScopeSchema = z.enum(["organization", "project"]);
const pluginEntitlementStateSchema = z.enum([
  "disabled",
  "enabled",
  "suspended",
]);

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export const pluginsSuperAdminProcedures = {
  pluginsListAccess: superAdminProcedure
    .input(
      z
        .object({
          pluginId: pluginIdSchema.optional(),
          search: z.string().trim().max(160).optional(),
          state: pluginEntitlementStateSchema.optional(),
          organizationId: organizationIdSchema.optional(),
          limit: z.number().int().min(1).max(500).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const payload = input ?? {};
      const selectedCatalog = (
        payload.pluginId
          ? listPluginCatalogEntries().filter(
              (plugin) => plugin.pluginId === payload.pluginId,
            )
          : listPluginCatalogEntries()
      ).sort((left, right) => left.sortOrder - right.sortOrder);

      const accessByPlugin = await Promise.all(
        selectedCatalog.map(async (plugin) => ({
          plugin,
          result: await pluginEntitlementService.listProjectAccess({
            pluginId: plugin.pluginId,
            search: payload.search,
            state: payload.state,
            organizationId: payload.organizationId,
            limit: 500,
            offset: 0,
          }),
        })),
      );

      const projectMap = new Map<
        string,
        {
          organizationId: string;
          organizationSlug: string;
          organizationName: string;
          projectSlug: string;
          projectTitle: string;
          isDeployed: boolean;
          deployedDomain: string | null;
          plugins: Map<
            string,
            {
              organizationId: string;
              pluginId: PluginId;
              projectSlug: string;
              catalog: (typeof selectedCatalog)[number];
              effectiveScope: "instance" | "organization" | "project" | "none";
              state: "disabled" | "enabled" | "suspended";
              managedBy: "manual_superadmin" | "plan" | "self_serve";
              monthlyEventLimit: number | null;
              hardStop: boolean;
              turnstileEnabled: boolean;
              turnstileReady: boolean;
              usageThisMonth: number;
              projectPluginStatus: "enabled" | "disabled" | null;
              updatedAt: string | null;
            }
          >;
        }
      >();

      for (const { plugin, result } of accessByPlugin) {
        for (const row of result.rows) {
          const key = `${row.organizationId}:${row.projectSlug}`;
          const existing = projectMap.get(key);
          if (existing) {
            existing.plugins.set(plugin.pluginId, {
              organizationId: row.organizationId,
              pluginId: plugin.pluginId,
              projectSlug: row.projectSlug,
              catalog: plugin,
              effectiveScope: row.effectiveScope,
              state: row.state,
              managedBy: row.managedBy,
              monthlyEventLimit: row.monthlyEventLimit,
              hardStop: row.hardStop,
              turnstileEnabled: row.turnstileEnabled,
              turnstileReady: row.turnstileReady,
              usageThisMonth: row.usageThisMonth,
              projectPluginStatus: row.projectPluginStatus,
              updatedAt: toIsoString(row.updatedAt),
            });
            continue;
          }

          projectMap.set(key, {
            organizationId: row.organizationId,
            organizationSlug: row.organizationSlug,
            organizationName: row.organizationName,
            projectSlug: row.projectSlug,
            projectTitle: row.projectTitle,
            isDeployed: row.isDeployed,
            deployedDomain: row.deployedDomain,
            plugins: new Map([
              [
                plugin.pluginId,
                {
                  organizationId: row.organizationId,
                  pluginId: plugin.pluginId,
                  projectSlug: row.projectSlug,
                  catalog: plugin,
                  effectiveScope: row.effectiveScope,
                  state: row.state,
                  managedBy: row.managedBy,
                  monthlyEventLimit: row.monthlyEventLimit,
                  hardStop: row.hardStop,
                  turnstileEnabled: row.turnstileEnabled,
                  turnstileReady: row.turnstileReady,
                  usageThisMonth: row.usageThisMonth,
                  projectPluginStatus: row.projectPluginStatus,
                  updatedAt: toIsoString(row.updatedAt),
                },
              ],
            ]),
          });
        }
      }

      const groupedRows = Array.from(projectMap.values())
        .map((project) => {
          const plugins = selectedCatalog.map((plugin) => {
            return (
              project.plugins.get(plugin.pluginId) ?? {
                organizationId: project.organizationId,
                pluginId: plugin.pluginId,
                projectSlug: project.projectSlug,
                catalog: plugin,
                effectiveScope: "none" as const,
                state: "disabled" as const,
                managedBy: "manual_superadmin" as const,
                monthlyEventLimit: null,
                hardStop: true,
                turnstileEnabled: false,
                turnstileReady: false,
                usageThisMonth: 0,
                projectPluginStatus: null,
                updatedAt: null,
              }
            );
          });
          const updatedAt = plugins.reduce<string | null>((latest, plugin) => {
            if (!plugin.updatedAt) return latest;
            if (!latest) return plugin.updatedAt;
            return plugin.updatedAt > latest ? plugin.updatedAt : latest;
          }, null);

          return {
            organizationId: project.organizationId,
            organizationSlug: project.organizationSlug,
            organizationName: project.organizationName,
            projectSlug: project.projectSlug,
            projectTitle: project.projectTitle,
            isDeployed: project.isDeployed,
            deployedDomain: project.deployedDomain,
            plugins,
            updatedAt,
          };
        })
        .sort((left, right) => {
          const orgOrder = left.organizationName.localeCompare(right.organizationName);
          if (orgOrder !== 0) return orgOrder;
          return left.projectSlug.localeCompare(right.projectSlug);
        });

      const offset = Math.max(0, payload.offset ?? 0);
      const limit = Math.max(1, Math.min(500, payload.limit ?? 100));

      return {
        pluginCatalog: selectedCatalog,
        rows: groupedRows.slice(offset, offset + limit),
        total: groupedRows.length,
      };
    }),

  pluginsUpsertEntitlement: superAdminProcedure
    .input(
      z
        .object({
          pluginId: pluginIdSchema,
          organizationId: organizationIdSchema,
          scope: pluginEntitlementScopeSchema,
          projectSlug: z.string().trim().min(1).optional(),
          state: pluginEntitlementStateSchema,
          monthlyEventLimit: z.number().int().min(0).nullable().optional(),
          hardStop: z.boolean().optional(),
          turnstileEnabled: z.boolean().optional(),
          notes: z.string().max(1000).optional(),
          ensurePluginWhenEnabled: z.boolean().optional(),
        })
        .refine((data) => (data.scope === "project" ? !!data.projectSlug : true), {
          message: "projectSlug is required for project scope",
          path: ["projectSlug"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingProjectEntitlement =
        input.scope === "project"
          ? await pluginEntitlementService.getProjectEntitlementRow({
              organizationId: input.organizationId,
              projectSlug: input.projectSlug!,
              pluginId: input.pluginId,
            })
          : null;

      const preparedEntitlementFields =
        input.scope === "project"
          ? await preparePluginProjectEntitlementFields({
              pluginId: input.pluginId,
              organizationId: input.organizationId,
              projectSlug: input.projectSlug!,
              state: input.state,
              turnstileEnabled: input.turnstileEnabled ?? false,
              existingProjectEntitlement: existingProjectEntitlement
                ? {
                    turnstileWidgetId:
                      existingProjectEntitlement.turnstileWidgetId ?? null,
                    turnstileSiteKey:
                      existingProjectEntitlement.turnstileSiteKey ?? null,
                    turnstileSecretKey:
                      existingProjectEntitlement.turnstileSecretKey ?? null,
                  }
                : null,
            })
          : {
              turnstileEnabled: input.turnstileEnabled ?? false,
              turnstileWidgetId: null,
              turnstileSiteKey: null,
              turnstileSecretKey: null,
            };

      const entitlement = await pluginEntitlementService.upsertEntitlement({
        organizationId: input.organizationId,
        scope: input.scope,
        projectSlug: input.projectSlug,
        pluginId: input.pluginId,
        state: input.state,
        managedBy: "manual_superadmin",
        monthlyEventLimit: input.monthlyEventLimit,
        hardStop: input.hardStop,
        turnstileEnabled: preparedEntitlementFields.turnstileEnabled,
        turnstileWidgetId: preparedEntitlementFields.turnstileWidgetId,
        turnstileSiteKey: preparedEntitlementFields.turnstileSiteKey,
        turnstileSecretKey: preparedEntitlementFields.turnstileSecretKey,
        notes: input.notes,
        changedByUserId: ctx.session.user.id,
      });

      let ensuredPluginInstanceId: string | null = null;
      if (
        input.scope === "project" &&
        input.state === "enabled" &&
        input.ensurePluginWhenEnabled !== false
      ) {
        const ensured = await projectPluginService.ensurePluginInstance({
          organizationId: input.organizationId,
          projectSlug: input.projectSlug!,
          pluginId: input.pluginId,
        });
        ensuredPluginInstanceId = ensured.instanceId;
      }

      if (input.scope === "project") {
        await cleanupPluginProjectEntitlementFields({
          pluginId: input.pluginId,
          state: input.state,
          turnstileEnabled: input.turnstileEnabled ?? false,
          existingProjectEntitlement: existingProjectEntitlement
            ? {
                turnstileWidgetId: existingProjectEntitlement.turnstileWidgetId ?? null,
                turnstileSiteKey: existingProjectEntitlement.turnstileSiteKey ?? null,
                turnstileSecretKey: existingProjectEntitlement.turnstileSecretKey ?? null,
              }
            : null,
        });
      }

      return {
        success: true,
        entitlement: {
          id: entitlement.id,
          organizationId: entitlement.organizationId,
          scope: entitlement.scope,
          projectSlug: entitlement.projectSlug,
          pluginId: entitlement.pluginId,
          state: entitlement.state,
          managedBy: entitlement.managedBy,
          monthlyEventLimit: entitlement.monthlyEventLimit,
          hardStop: entitlement.hardStop,
          turnstileEnabled: entitlement.turnstileEnabled,
          turnstileReady:
            !!entitlement.turnstileSiteKey && !!entitlement.turnstileSecretKey,
          notes: entitlement.notes,
          changedByUserId: entitlement.changedByUserId,
          updatedAt: entitlement.updatedAt,
        },
        ensuredPluginInstanceId,
      };
    }),

  pluginsBulkSetForOrganization: superAdminProcedure
    .input(
      z.object({
        pluginId: pluginIdSchema,
        organizationId: organizationIdSchema,
        state: pluginEntitlementStateSchema,
        monthlyEventLimit: z.number().int().min(0).nullable().optional(),
        hardStop: z.boolean().optional(),
        turnstileEnabled: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entitlement = await pluginEntitlementService.upsertEntitlement({
        organizationId: input.organizationId,
        scope: "organization",
        pluginId: input.pluginId,
        state: input.state,
        managedBy: "manual_superadmin",
        monthlyEventLimit: input.monthlyEventLimit,
        hardStop: input.hardStop,
        turnstileEnabled: input.turnstileEnabled ?? false,
        turnstileWidgetId: null,
        turnstileSiteKey: null,
        turnstileSecretKey: null,
        notes: input.notes,
        changedByUserId: ctx.session.user.id,
      });

      return {
        success: true,
        entitlement: {
          id: entitlement.id,
          organizationId: entitlement.organizationId,
          scope: entitlement.scope,
          projectSlug: entitlement.projectSlug,
          pluginId: entitlement.pluginId,
          state: entitlement.state,
          managedBy: entitlement.managedBy,
          monthlyEventLimit: entitlement.monthlyEventLimit,
          hardStop: entitlement.hardStop,
          turnstileEnabled: entitlement.turnstileEnabled,
          turnstileReady:
            !!entitlement.turnstileSiteKey && !!entitlement.turnstileSecretKey,
          notes: entitlement.notes,
          changedByUserId: entitlement.changedByUserId,
          updatedAt: entitlement.updatedAt,
        },
      };
    }),
};
